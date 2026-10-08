type ButtonProps = {
  label: string;
  onClick?: () => void;
  variant?: "primary" | "secondary";
};

export default function Button({ label, onClick, variant = "primary" }: ButtonProps) {
  const styles =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : "bg-gray-200 text-gray-900 hover:bg-gray-300";

  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 font-medium transition ${styles}`}
    >
      {label}
    </button>
  );
}