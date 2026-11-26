import { requirePermission } from "@/lib/access";
import "./water-treatment.css";

export default async function WaterTreatmentLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("water_treatment", "water_treatment");
  return <div className="water-treatment-module">{children}</div>;
}
