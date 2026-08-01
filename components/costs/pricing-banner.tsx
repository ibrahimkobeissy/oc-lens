import { CircleAlert } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function PricingBanner({ unpricedCount }: { unpricedCount: number }) {
  if (unpricedCount === 0) return null;
  return (
    <Alert className="border-warning/60 bg-warning/10">
      <CircleAlert aria-hidden="true" className="text-warning" />
      <AlertTitle>{unpricedCount} observed model{unpricedCount === 1 ? " is" : "s are"} not priced</AlertTitle>
      <AlertDescription><p>Displayed totals include only models with your own configured rates. <Link href="/settings/pricing" className="font-medium text-primary underline underline-offset-4">Set model prices</Link> to make the full cost picture honest.</p></AlertDescription>
    </Alert>
  );
}
