"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/access";
import { colomboDateTimeToISOString, isCalendarDate } from "@/lib/water-treatment-dates.mjs";

export type PlantActionResult = { error?: string; plantId?: string };

const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => value(form, key) || null;
const max = (text: string | null, length: number) => !text || text.length <= length;
const validId = (text: string) => /^[0-9a-f-]{36}$/i.test(text);

export async function savePlant(form: FormData): Promise<PlantActionResult> {
  const customerId = value(form, "customer_id");
  const plantId = value(form, "plant_id");
  const plantType = value(form, "plant_type");
  const siteAddress = value(form, "site_address");
  const capacityText = value(form, "capacity");
  const capacityUnit = optional(form, "capacity_unit");
  const serialNumber = optional(form, "serial_number");
  const manufacturer = optional(form, "manufacturer");
  const model = optional(form, "model");
  const notes = optional(form, "notes");
  const installationDate = optional(form, "installation_date");
  const status = value(form, "status");

  if (!validId(customerId) || (plantId && !validId(plantId))) return { error: "Select a valid customer and try again." };
  if (!plantType || plantType.length > 100 || !siteAddress || siteAddress.length > 1000) return { error: "Enter a plant type and physical site address." };
  if (!max(serialNumber, 200) || !max(manufacturer, 200) || !max(model, 200) || !max(notes, 5000) || !max(capacityUnit, 40)) return { error: "One or more fields exceed the allowed length." };
  if ((capacityText && !capacityUnit) || (!capacityText && capacityUnit)) return { error: "Enter both capacity and its unit, or leave both blank." };
  const capacity = capacityText ? Number(capacityText) : null;
  if (capacity !== null && (!Number.isFinite(capacity) || capacity <= 0)) return { error: "Capacity must be a positive number." };
  if (installationDate && !isCalendarDate(installationDate)) return { error: "Enter a real installation date (for example, 2024-02-29)." };
  if (!["active", "inactive", "decommissioned"].includes(status)) return { error: "Choose a valid plant status." };

  const { supabase: s, profile } = await requirePermission("water_treatment", "water_treatment");
  const { data: customer, error: customerError } = await s.from("customers").select("id,center_id").eq("id", customerId).eq("organization_id", profile.organization_id).maybeSingle();
  if (customerError || !customer) return { error: "That customer is unavailable in your permitted centers." };

  const payload = {
    customer_id: customer.id,
    center_id: customer.center_id,
    serial_number: serialNumber,
    plant_type: plantType,
    manufacturer,
    model,
    capacity,
    capacity_unit: capacity === null ? null : capacityUnit,
    installation_date: installationDate,
    site_address: siteAddress,
    status,
    notes,
  };
  let savedId = plantId;
  if (plantId) {
    const { data, error } = await s.from("water_treatment_plants").update(payload).eq("id", plantId).eq("organization_id", profile.organization_id).select("id").maybeSingle();
    if (error || !data) return { error: "Plant could not be updated. Check access and try again." };
    savedId = data.id;
  } else {
    const { data, error } = await s.from("water_treatment_plants").insert({ ...payload, organization_id: profile.organization_id, created_by: profile.id }).select("id").single();
    if (error || !data) return { error: "Plant could not be created. Check the details and try again." };
    savedId = data.id;
  }
  revalidatePath("/dashboard/water-treatment");
  revalidatePath(`/dashboard/water-treatment/${savedId}`);
  return { plantId: savedId };
}

export async function addPlantHistory(form: FormData): Promise<PlantActionResult> {
  const plantId = value(form, "plant_id");
  const recordType = value(form, "record_type");
  const summary = value(form, "summary");
  const details = optional(form, "details");
  const occurredAt = optional(form, "occurred_at");
  const nextServiceDate = optional(form, "next_service_date");
  const allowedTypes = ["installation", "service", "repair", "maintenance", "inspection"];
  if (!validId(plantId) || !allowedTypes.includes(recordType)) return { error: "Choose a valid history type." };
  if (!summary || summary.length > 200 || !max(details, 5000)) return { error: "Enter a summary of up to 200 characters and details of up to 5,000 characters." };
  const occurredAtUtc = occurredAt ? colomboDateTimeToISOString(occurredAt) : null;
  if (occurredAt && !occurredAtUtc) return { error: "Enter a real date and time in Asia/Colombo." };
  if (nextServiceDate && !isCalendarDate(nextServiceDate)) return { error: "Enter a real next service date (for example, 2024-02-29)." };

  const { supabase: s, profile } = await requirePermission("water_treatment", "water_treatment");
  const { data: plant, error: plantError } = await s.from("water_treatment_plants").select("id,organization_id,center_id").eq("id", plantId).eq("organization_id", profile.organization_id).maybeSingle();
  if (plantError || !plant) return { error: "Plant is unavailable in your permitted centers." };
  const { error } = await s.from("water_treatment_plant_history").insert({
    plant_id: plant.id,
    organization_id: profile.organization_id,
    center_id: plant.center_id,
    record_type: recordType,
    summary,
    details,
    ...(occurredAtUtc ? { occurred_at: occurredAtUtc } : {}),
    next_service_date: nextServiceDate,
    recorded_by: profile.id,
  });
  if (error) return { error: "History could not be added. Check the details and try again." };
  revalidatePath(`/dashboard/water-treatment/${plantId}`);
  return { plantId };
}
