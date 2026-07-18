use anchor_lang::prelude::*;

declare_id!("Diu1knrbYFraN5oSzjEW2RBjRW1obVo2iNz7vHDVrLET");

#[program]
pub mod nextgoal_escrow {
    use super::*;

    /// Creates one escrow PDA for one off-chain game session.
    pub fn initialize_session(
        ctx: Context<InitializeSession>,
        session_id: [u8; 32],
        entry_lamports: u64,
    ) -> Result<()> {
        require!(entry_lamports > 0, EscrowError::InvalidEntryAmount);

        let escrow = &mut ctx.accounts.escrow;
        escrow.session_id = session_id;
        escrow.authority = ctx.accounts.authority.key();
        escrow.settlement_authority = SETTLEMENT_AUTHORITY;
        escrow.entry_lamports = entry_lamports;
        escrow.prize_pool = 0;
        escrow.depositors = Vec::new();
        escrow.bump = ctx.bumps.escrow;

        emit!(SessionInitialized {
            escrow: escrow.key(),
            authority: escrow.authority,
            session_id,
            entry_lamports,
        });
        Ok(())
    }

    /// Adds exactly one entry fee to the session prize pool.
    pub fn deposit(ctx: Context<Deposit>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let depositor = ctx.accounts.depositor.key();

        require!(
            !escrow.depositors.contains(&depositor),
            EscrowError::AlreadyDeposited
        );
        require!(
            escrow.depositors.len() < MAX_DEPOSITORS,
            EscrowError::SessionFull
        );

        let amount = escrow.entry_lamports;
        let transfer_accounts = anchor_lang::system_program::Transfer {
            from: ctx.accounts.depositor.to_account_info(),
            to: escrow.to_account_info(),
        };
        anchor_lang::system_program::transfer(
            CpiContext::new(anchor_lang::system_program::ID, transfer_accounts),
            amount,
        )?;

        escrow.depositors.push(depositor);
        escrow.prize_pool = escrow
            .prize_pool
            .checked_add(amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;

        emit!(Deposited {
            escrow: escrow.key(),
            depositor,
            amount,
            prize_pool: escrow.prize_pool,
        });
        Ok(())
    }

    /// Pays the complete pool to one winner, or divides it across tied winners.
    /// The game authority supplies winner accounts in the same order as `winners`.
    pub fn settle(ctx: Context<Settle>, winners: Vec<Pubkey>) -> Result<()> {
        require!(!winners.is_empty(), EscrowError::NoWinners);
        require!(winners.len() <= MAX_WINNERS, EscrowError::TooManyWinners);
        require!(
            winners.len() == ctx.remaining_accounts.len(),
            EscrowError::WinnerAccountsMismatch
        );

        for (index, winner) in winners.iter().enumerate() {
            require!(
                !winners[..index].contains(winner),
                EscrowError::DuplicateWinner
            );
            require_keys_eq!(
                *winner,
                ctx.remaining_accounts[index].key(),
                EscrowError::WinnerAccountsMismatch
            );
        }

        let escrow = &mut ctx.accounts.escrow;
        let pool = escrow.prize_pool;
        require!(pool > 0, EscrowError::EmptyPrizePool);

        let share = pool / winners.len() as u64;
        let remainder = pool % winners.len() as u64;
        for (index, winner_account) in ctx.remaining_accounts.iter().enumerate() {
            let amount = share + u64::from(index == 0) * remainder;
            **escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
            **winner_account.try_borrow_mut_lamports()? += amount;
        }
        escrow.prize_pool = 0;

        emit!(Settled {
            escrow: escrow.key(),
            winners,
            prize_pool: pool,
        });
        // Anchor closes the now-empty escrow data account after this handler and
        // returns its rent reserve to the authority.
        Ok(())
    }

    /// Cancels an unplayed session and refunds every recorded entry fee.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.depositors.len() == ctx.remaining_accounts.len(),
            EscrowError::DepositorAccountsMismatch
        );

        let entry_lamports = escrow.entry_lamports;
        for (index, depositor) in escrow.depositors.iter().enumerate() {
            require_keys_eq!(
                *depositor,
                ctx.remaining_accounts[index].key(),
                EscrowError::DepositorAccountsMismatch
            );
            **escrow.to_account_info().try_borrow_mut_lamports()? -= entry_lamports;
            **ctx.remaining_accounts[index].try_borrow_mut_lamports()? += entry_lamports;
        }
        escrow.prize_pool = 0;

        emit!(Cancelled {
            escrow: escrow.key(),
            refunded: escrow.depositors.len() as u8,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(session_id: [u8; 32])]
pub struct InitializeSession<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + SessionEscrow::INIT_SPACE,
        seeds = [ESCROW_SEED, session_id.as_ref()],
        bump
    )]
    pub escrow: Account<'info, SessionEscrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.session_id.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, SessionEscrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub settlement_authority: Signer<'info>,
    /// CHECK: This is only the rent recipient and must match the stored host.
    #[account(mut, address = escrow.authority)]
    pub authority: UncheckedAccount<'info>,
    #[account(
        mut,
        has_one = settlement_authority @ EscrowError::InvalidSettlementAuthority,
        seeds = [ESCROW_SEED, escrow.session_id.as_ref()],
        bump = escrow.bump,
        close = authority
    )]
    pub escrow: Account<'info, SessionEscrow>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        has_one = authority @ EscrowError::Unauthorized,
        seeds = [ESCROW_SEED, escrow.session_id.as_ref()],
        bump = escrow.bump,
        close = authority
    )]
    pub escrow: Account<'info, SessionEscrow>,
}

#[account]
#[derive(InitSpace)]
pub struct SessionEscrow {
    pub session_id: [u8; 32],
    pub authority: Pubkey,
    pub settlement_authority: Pubkey,
    pub entry_lamports: u64,
    pub prize_pool: u64,
    #[max_len(16)]
    pub depositors: Vec<Pubkey>,
    pub bump: u8,
}

#[constant]
pub const ESCROW_SEED: &[u8] = b"nextgoal";
pub const SETTLEMENT_AUTHORITY: Pubkey = pubkey!("6XYhnadptgK7a9UpC44XeKcWefX1pEuZHGkYHHUPE6Uj");
pub const MAX_DEPOSITORS: usize = 16;
pub const MAX_WINNERS: usize = 16;

#[event]
pub struct SessionInitialized {
    pub escrow: Pubkey,
    pub authority: Pubkey,
    pub session_id: [u8; 32],
    pub entry_lamports: u64,
}

#[event]
pub struct Deposited {
    pub escrow: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
    pub prize_pool: u64,
}

#[event]
pub struct Settled {
    pub escrow: Pubkey,
    pub winners: Vec<Pubkey>,
    pub prize_pool: u64,
}

#[event]
pub struct Cancelled {
    pub escrow: Pubkey,
    pub refunded: u8,
}

#[error_code]
pub enum EscrowError {
    #[msg("The entry fee must be greater than zero")]
    InvalidEntryAmount,
    #[msg("This wallet has already deposited into the session")]
    AlreadyDeposited,
    #[msg("The session has reached its depositor limit")]
    SessionFull,
    #[msg("The prize pool arithmetic overflowed")]
    ArithmeticOverflow,
    #[msg("At least one winner is required")]
    NoWinners,
    #[msg("The winner list exceeds the supported limit")]
    TooManyWinners,
    #[msg("Winner accounts do not match the declared winners")]
    WinnerAccountsMismatch,
    #[msg("A winner was supplied more than once")]
    DuplicateWinner,
    #[msg("The prize pool is empty")]
    EmptyPrizePool,
    #[msg("Only the session authority can perform this action")]
    Unauthorized,
    #[msg("Refund accounts do not match the session depositors")]
    DepositorAccountsMismatch,
    #[msg("Only the NextGoal application can settle this session")]
    InvalidSettlementAuthority,
}
