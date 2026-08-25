import { Hono } from "hono";
import { apiError, type Env } from "../index";
import { createD1Store } from "../domain/store";
import { packetConfidence } from "../domain/evidence";

export const packetRoutes = new Hono<{ Bindings: Env }>();

packetRoutes.get("/incidents/:id/packet", async (c) => {
  const incidentId = c.req.param("id");
  const store = createD1Store(c.env.DB);

  const packet = await store.getPacketByIncident(incidentId);
  if (packet === null) {
    return c.json(apiError("not_found", `No evidence packet found for incident "${incidentId}"`), 404);
  }

  const confidence = packetConfidence(packet);
  return c.json({ ok: true, data: { packet, confidence } });
});

export default packetRoutes;
