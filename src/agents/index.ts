import { Router } from "express";
import { getDb } from "../clients/mongodb.js";

const router = Router();

/** Agent interface */
interface Agent {
    agentId: string;
    name: string;
    systemPrompt: string;
    model: string;
    mcpServers?: string[];
    [key: string]: any;
}

// GET all agents or single agent by ?id=
router.get("/", async (req, res) => {
    try {
        const db = await getDb();
        const { id } = req.query;

        if (id) {
            const agent = await db.collection<Agent>("agent_config").findOne({ agentId: id.toString() });
            if (!agent) return res.status(404).json({ ok: false, error: "Agent not found" });
            return res.json({ ok: true, agent });
        }

        const agents = await db.collection<Agent>("agent_config").find({}).toArray();
        res.json({ ok: true, agents });
    } catch (err: any) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST create a new agent
router.post("/", async (req, res) => {
    try {
        
        const db = await getDb();
        const payload: Agent = req.body;

        const requiredFields: (keyof Agent)[] = ["agentId", "name", "systemPrompt", "model"];
        for (const field of requiredFields) {
            if (!payload[field]) {
                return res.status(400).json({ ok: false, error: `Missing required field: ${field}` });
            }
        }
        
        await db.collection<Agent>("agent_config").insertOne(payload);
        res.status(201).json({ ok: true, agent: payload });
    } catch (err: any) {
        if (err.code === 11000) {
            return res.status(409).json({ ok: false, error: 'Agent with this agentId already exists' });
        }
        res.status(500).json({ ok: false, error: err.message });
    }
});

// PATCH update an agent by agentId
router.patch("/", async (req, res) => {
  try {
    const db = await getDb();
    const { agentId, ...updates } = req.body as Partial<Agent> & { agentId: string };

    if (!agentId) return res.status(400).json({ ok: false, error: "Missing agentId" });

    // Prevent changing agentId
    if ("agentId" in updates) delete updates.agentId;

    // Only allow updating certain fields
    const allowedFields: (keyof Agent)[] = ["name", "systemPrompt", "model", "mcpServers"];
    const sanitizedUpdates: Partial<Agent> = {};
    for (const field of allowedFields) {
      if (field in updates) sanitizedUpdates[field] = updates[field];
    }

    const result = await db
      .collection<Agent>("agent_config")
      .findOneAndUpdate(
        { agentId },
        { $set: sanitizedUpdates },
        { returnDocument: "after" }
      );

    if (!result) {
        return res.status(404).json({ ok: false, error: "Agent not found" });}

    res.json({ ok: true, agent: result });

  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;