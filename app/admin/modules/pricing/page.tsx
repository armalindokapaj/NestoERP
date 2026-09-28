import { PricingAdministration } from "@/components/pricing/pricing-administration";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getPricingAdministration } from "@/lib/modules/pricing/pricing.service";

export const metadata = { title: "Pricing" };

export default async function PricingAdministrationPage() {
  const context = await requirePlatformContext();
  const data = await getPricingAdministration(context);
  return <div className="space-y-5"><PageHeader title="Pricing" description="Publish versioned public price books, manage promotions, and review saved commercial configurations." /><PricingAdministration data={data} /></div>;
}
