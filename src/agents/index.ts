import { Router } from "express";
import { getDb } from "../clients/mongodb.js";

const router = Router();

/** Agent interface */
interface Agent {
    agent_id: string;
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
            const agent = await db.collection<Agent>("agent_config").findOne({ agent_id: id.toString() });
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

        const requiredFields: (keyof Agent)[] = ["agent_id", "name", "systemPrompt", "model"];
        for (const field of requiredFields) {
            if (!payload[field]) {
                return res.status(400).json({ ok: false, error: `Missing required field: ${field}` });
            }
        }
        
        await db.collection<Agent>("agent_config").insertOne(payload);
        res.status(201).json({ ok: true, agent: payload });
    } catch (err: any) {
        if (err.code === 11000) {
            return res.status(409).json({ ok: false, error: 'Agent with this agent_id already exists' });
        }
        res.status(500).json({ ok: false, error: err.message });
    }
});

// PATCH update an agent by agent_id
router.patch("/", async (req, res) => {
  try {
    const db = await getDb();
    const { agent_id, ...updates } = req.body as Partial<Agent> & { agent_id: string };

    if (!agent_id) return res.status(400).json({ ok: false, error: "Missing agent_id" });

    // Prevent changing agent_id
    if ("agent_id" in updates) delete updates.agent_id;

    // Only allow updating certain fields
    const allowedFields: (keyof Agent)[] = ["name", "description", "gemini_voice", "system_prompt", "model", "mcp_servers"];
    const sanitizedUpdates: Partial<Agent> = {};
    for (const field of allowedFields) {
      if (field in updates) sanitizedUpdates[field] = updates[field];
    }

    const result = await db
      .collection<Agent>("agent_config")
      .findOneAndUpdate(
        { agent_id },
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