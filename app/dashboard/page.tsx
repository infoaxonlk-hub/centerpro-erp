import {getDashboardSummary} from "@/lib/dashboard-data";
import {DashboardMetrics} from "@/components/dashboard-metrics";
export default async function DashboardPage(){return <DashboardMetrics summary={await getDashboardSummary()}/>;}
