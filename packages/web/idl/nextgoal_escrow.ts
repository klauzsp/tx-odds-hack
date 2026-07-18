/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/nextgoal_escrow.json`.
 */
export type NextgoalEscrow = {
  "address": "Diu1knrbYFraN5oSzjEW2RBjRW1obVo2iNz7vHDVrLET",
  "metadata": {
    "name": "nextgoalEscrow",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Per-session SOL prize pool escrow for NextGoal"
  },
  "instructions": [
    {
      "name": "cancel",
      "docs": [
        "Cancels an unplayed session and refunds every recorded entry fee."
      ],
      "discriminator": [
        232,
        219,
        223,
        41,
        219,
        236,
        220,
        190
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "escrow"
          ]
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  101,
                  120,
                  116,
                  103,
                  111,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "escrow.sessionId",
                "account": "sessionEscrow"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "deposit",
      "docs": [
        "Adds exactly one entry fee to the session prize pool."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "depositor",
          "writable": true,
          "signer": true
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  101,
                  120,
                  116,
                  103,
                  111,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "escrow.sessionId",
                "account": "sessionEscrow"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeSession",
      "docs": [
        "Creates one escrow PDA for one off-chain game session."
      ],
      "discriminator": [
        69,
        130,
        92,
        236,
        107,
        231,
        159,
        129
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  101,
                  120,
                  116,
                  103,
                  111,
                  97,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "sessionId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "sessionId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "entryLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settle",
      "docs": [
        "Pays the complete pool to one winner, or divides it across tied winners.",
        "The game authority supplies winner accounts in the same order as `winners`."
      ],
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "escrow"
          ]
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  101,
                  120,
                  116,
                  103,
                  111,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "escrow.sessionId",
                "account": "sessionEscrow"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "winners",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "sessionEscrow",
      "discriminator": [
        251,
        205,
        39,
        211,
        38,
        92,
        234,
        241
      ]
    }
  ],
  "events": [
    {
      "name": "cancelled",
      "discriminator": [
        136,
        23,
        42,
        65,
        143,
        233,
        234,
        46
      ]
    },
    {
      "name": "deposited",
      "discriminator": [
        111,
        141,
        26,
        45,
        161,
        35,
        100,
        57
      ]
    },
    {
      "name": "sessionInitialized",
      "discriminator": [
        22,
        195,
        156,
        137,
        167,
        239,
        207,
        87
      ]
    },
    {
      "name": "settled",
      "discriminator": [
        232,
        210,
        40,
        17,
        142,
        124,
        145,
        238
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidEntryAmount",
      "msg": "The entry fee must be greater than zero"
    },
    {
      "code": 6001,
      "name": "alreadyDeposited",
      "msg": "This wallet has already deposited into the session"
    },
    {
      "code": 6002,
      "name": "sessionFull",
      "msg": "The session has reached its depositor limit"
    },
    {
      "code": 6003,
      "name": "arithmeticOverflow",
      "msg": "The prize pool arithmetic overflowed"
    },
    {
      "code": 6004,
      "name": "noWinners",
      "msg": "At least one winner is required"
    },
    {
      "code": 6005,
      "name": "tooManyWinners",
      "msg": "The winner list exceeds the supported limit"
    },
    {
      "code": 6006,
      "name": "winnerAccountsMismatch",
      "msg": "Winner accounts do not match the declared winners"
    },
    {
      "code": 6007,
      "name": "duplicateWinner",
      "msg": "A winner was supplied more than once"
    },
    {
      "code": 6008,
      "name": "emptyPrizePool",
      "msg": "The prize pool is empty"
    },
    {
      "code": 6009,
      "name": "unauthorized",
      "msg": "Only the session authority can perform this action"
    },
    {
      "code": 6010,
      "name": "depositorAccountsMismatch",
      "msg": "Refund accounts do not match the session depositors"
    }
  ],
  "types": [
    {
      "name": "cancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "escrow",
            "type": "pubkey"
          },
          {
            "name": "refunded",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "deposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "escrow",
            "type": "pubkey"
          },
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "prizePool",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "sessionEscrow",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sessionId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "entryLamports",
            "type": "u64"
          },
          {
            "name": "prizePool",
            "type": "u64"
          },
          {
            "name": "depositors",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "sessionInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "escrow",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "sessionId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "entryLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "settled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "escrow",
            "type": "pubkey"
          },
          {
            "name": "winners",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "prizePool",
            "type": "u64"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "escrowSeed",
      "type": "bytes",
      "value": "[110, 101, 120, 116, 103, 111, 97, 108]"
    }
  ]
};
