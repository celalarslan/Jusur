import jusoorIcon from "./Jusoor_icon.png";

export function Logo({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <img
      src={jusoorIcon}
      alt="Jusoor"
      className={`${className} object-contain`}
      draggable={false}
    />
  );
}
