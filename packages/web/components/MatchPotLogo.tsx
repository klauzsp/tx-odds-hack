import Image from "next/image";
import matchPotLogo from "../../../matchpotlogo.png";

export default function MatchPotLogo({ size }: { size: "nav" | "hero" }) {
  return (
    <span className={`matchPotLogo matchPotLogo--${size}`} aria-hidden="true">
      <Image src={matchPotLogo} alt="" fill sizes={size === "nav" ? "44px" : "156px"} priority />
    </span>
  );
}
