"use client";

import { useRef, useState, useTransition } from "react";
import { CalendarPlus, Plus } from "lucide-react";
import { addPlantHistory } from "./actions";

export function PlantHistoryForm({ plantId }: { plantId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function submit(form: FormData) {
    setError("");
    startTransition(async () => {
      const result = await addPlantHistory(form);
      if (result.error) { setError(result.error); return; }
      formRef.current?.reset();
    });
  }

  return <form ref={formRef} action={submit} className="wt-history-form">
    <input type="hidden" name="plant_id" value={plantId}/>
    <label>Record Type<select name="record_type" defaultValue="service" required><option value="installation">Installation</option><option value="service">Service</option><option value="repair">Repair</option><option value="maintenance">Maintenance</option><option value="inspection">Inspection</option></select></label>
    <label>Date and Time<input name="occurred_at" type="datetime-local"/></label>
    <label>Summary<input name="summary" maxLength={200} required placeholder="What was done or observed?"/></label>
    <label>Details <span className="wt-optional">Optional</span><textarea name="details" rows={3} maxLength={5000}/></label>
    <label>Next Service Date <span className="wt-optional">Optional</span><input name="next_service_date" type="date"/></label>
    {error&&<p className="alert error" role="alert">{error}</p>}
    <button className="primary" disabled={pending}>{pending?<CalendarPlus size={16}/>:<Plus size={16}/>} {pending?"Adding…":"Add history record"}</button>
  </form>;
}
