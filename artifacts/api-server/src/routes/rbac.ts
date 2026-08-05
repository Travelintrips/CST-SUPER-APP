import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin, requireClerkUser } from "../lib/requireAdmin.js";
import { invalidateRbacCache } from "../lib/rbacMiddleware.js";

const router = Router();

const SYSTEM_ROLES = [
  "super_admin", "admin", "sales", "operations",
  "finance", "vendor", "driver", "customer",
] as const;

const MODULES = [
  "rfq", "invoice", "purchase", "customer_approval",
  "pod", "templates", "settings",
] as const;

const ACTIONS = ["view", "create", "edit", "approve", "delete"] as const;

type SystemRole = typeof SYSTEM_ROLES[number];
type Module = typeof MODULES[number];
type Action = typeof ACTIONS[number];

const DEFAULT_PERMISSIONS: Record<SystemRole, Partial<Record<Module, Action[]>>> = {
  super_admin: {
    rfq: ["view","create","edit","approve","delete"],
    invoice: ["view","create","edit","approve","delete"],
    purchase: ["view","create","edit","approve","delete"],
    customer_approval: ["view","create","edit","approve","delete"],
    pod: ["view","create","edit","approve","delete"],
    templates: ["view","create","edit","approve","delete"],
    settings: ["view","create","edit","approve","delete"],
  },
  admin: {
    rfq: ["view","create","edit","approve","delete"],
    invoice: ["view","create","edit","approve","delete"],
    purchase: ["view","create","edit","approve","delete"],
    customer_approval: ["view","create","edit","approve","delete"],
    pod: ["view","create","edit","approve","delete"],
    templates: ["view","create","edit","approve","delete"],
    settings: ["view","create","edit","approve"],
  },
  sales: {
    rfq: ["view","create","edit","approve"],
    invoice: ["view","create"],
    purchase: [],
    customer_approval: ["view","approve"],
    pod: ["view"],
    templates: ["view"],
    settings: [],
  },
  operations: {
    rfq: ["view","create","edit","approve","delete"],
    invoice: ["view"],
    purchase: ["view","create","edit","approve"],
    customer_approval: ["view","approve"],
    pod: ["view","create","edit","approve","delete"],
    templates: ["view"],
    settings: [],
  },
  finance: {
    rfq: ["view"],
    invoice: ["view","create","edit","approve","delete"],
    purchase: ["view","approve"],
    customer_approval: ["view"],
    pod: ["view"],
    templates: ["view"],
    settings: [],
  },
  vendor: {
    rfq: ["view"],
    invoice: ["view"],
    purchase: [],
    customer_approval: [],
    pod: ["view","create","edit"],
    templates: ["view"],
    settings: [],
  },
  driver: {
    rfq: [],
    invoice: [],
    purchase: [],
    customer_approval: [],
    pod: ["view","create","edit"],
    templates: [],
    settings: [],
  },
  customer: {
    rfq: ["view","create"],
    invoice: ["view"],
    purchase: [],
    customer_approval: ["view"],
    pod: [],
    templates: [],
    settings: [],
  },
};

let tableReady = false;

async function ensureTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_role_permissions (
      id SERIAL PRIMARY KEY,
      role_name TEXT NOT NULL,
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      CONSTRAINT rbac_role_permissions_unique UNIQUE (role_name, module, action)
    )
  `);

  await db.execute(sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS system_role TEXT
  `);

  const countRes = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM rbac_role_permissions`);
  const cnt = Number((countRes.rows[0] as any)?.cnt ?? 0);
  if (cnt === 0) {
    for (const [roleName, modules] of Object.entries(DEFAULT_PERMISSIONS)) {
      for (const [module, actions] of Object.entries(modules)) {
        for (const action of (actions as string[])) {
          await db.execute(sql`
            INSERT INTO rbac_role_permissions (role_name, module, action)
            VALUES (${roleName}, ${module}, ${action})
            ON CONFLICT DO NOTHING
          `);
        }
      }
    }
  }
}

router.use(async (_req: Request, _res: Response, next) => {
  if (!tableReady) {
    await ensureTable();
    tableReady = true;
  }
  next();
});

router.get("/constants", (_req: Request, res: Response) => {
  res.json({ roles: SYSTEM_ROLES, modules: MODULES, actions: ACTIONS });
});

router.get("/matrix", async (req: Request, res: Response) => {
  const ok = await requireClerkUser(req, res);
  if (!ok) return;

  const rows = await db.execute(sql`
    SELECT role_name, module, action FROM rbac_role_permissions ORDER BY role_name, module, action
  `);

  const matrix: Record<string, Record<string, string[]>> = {};
  for (const role of SYSTEM_ROLES) {
    matrix[role] = Object.fromEntries(MODULES.map((m) => [m, []]));
  }

  for (const row of rows.rows as Array<{ role_name: string; module: string; action: string }>) {
    if (!matrix[row.role_name]) continue;
    if (!matrix[row.role_name][row.module]) matrix[row.role_name][row.module] = [];
    matrix[row.role_name][row.module].push(row.action);
  }

  res.json({ roles: SYSTEM_ROLES, modules: MODULES, actions: ACTIONS, matrix });
});

router.post("/matrix/toggle", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const { roleName, module, action } = req.body as {
    roleName: string; module: string; action: string;
  };

  if (!SYSTEM_ROLES.includes(roleName as SystemRole))
    return res.status(400).json({ message: "Role tidak valid" });
  if (!MODULES.includes(module as Module))
    return res.status(400).json({ message: "Modul tidak valid" });
  if (!ACTIONS.includes(action as Action))
    return res.status(400).json({ message: "Aksi tidak valid" });
  if (roleName === "super_admin")
    return res.status(400).json({ message: "Perizinan Super Admin tidak dapat diubah" });

  const exists = await db.execute(sql`
    SELECT id FROM rbac_role_permissions
    WHERE role_name = ${roleName} AND module = ${module} AND action = ${action}
  `);

  if (exists.rows.length > 0) {
    await db.execute(sql`
      DELETE FROM rbac_role_permissions
      WHERE role_name = ${roleName} AND module = ${module} AND action = ${action}
    `);
    invalidateRbacCache();
    return res.json({ granted: false });
  } else {
    await db.execute(sql`
      INSERT INTO rbac_role_permissions (role_name, module, action)
      VALUES (${roleName}, ${module}, ${action})
      ON CONFLICT DO NOTHING
    `);
    invalidateRbacCache();
    return res.json({ granted: true });
  }
});

router.post("/matrix/reset", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  await db.execute(sql`DELETE FROM rbac_role_permissions`);

  for (const [roleName, modules] of Object.entries(DEFAULT_PERMISSIONS)) {
    for (const [module, actions] of Object.entries(modules)) {
      for (const action of (actions as string[])) {
        await db.execute(sql`
          INSERT INTO rbac_role_permissions (role_name, module, action)
          VALUES (${roleName}, ${module}, ${action})
          ON CONFLICT DO NOTHING
        `);
      }
    }
  }

  invalidateRbacCache();
  res.json({ message: "Matrix perizinan berhasil direset ke default" });
});

router.get("/users", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const rows = await db.execute(sql`
    SELECT u.id, u.email, u.name, u.role, u.system_role,
           c.company_name
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    ORDER BY u.name, u.email
    LIMIT 500
  `);
  res.json(rows.rows);
});

router.put("/users/:id/system-role", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const { id } = req.params;
  const { systemRole } = req.body as { systemRole: string | null };

  if (systemRole && !SYSTEM_ROLES.includes(systemRole as SystemRole)) {
    return res.status(400).json({ message: "System role tidak valid" });
  }

  await db.execute(sql`
    UPDATE users SET system_role = ${systemRole ?? null}, updated_at = NOW()
    WHERE id = ${id}
  `);

  res.json({ message: "System role berhasil diperbarui" });
});

export default router;
