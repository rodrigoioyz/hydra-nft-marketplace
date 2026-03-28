import { SellForm } from "./SellForm";

export default function SellPage() {
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-bold text-white">List an NFT</h1>
      <SellForm />
    </div>
  );
}
