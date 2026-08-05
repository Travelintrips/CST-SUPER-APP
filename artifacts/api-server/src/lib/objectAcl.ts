const ACL_POLICY_METADATA_KEY = "acl_policy";

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
}

export interface SupabaseFileHandle {
  bucket: string;
  path: string;
  metadata?: Record<string, string>;
}

export async function setObjectAclPolicy(_objectFile: SupabaseFileHandle, _aclPolicy: ObjectAclPolicy): Promise<void> {
  // ACL is stored as Supabase object metadata via upsert — no-op here;
  // ownership is tracked via the DB (objectPath stored in DB rows).
}

export async function getObjectAclPolicy(objectFile: SupabaseFileHandle): Promise<ObjectAclPolicy | null> {
  const raw = objectFile.metadata?.[ACL_POLICY_METADATA_KEY];
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: SupabaseFileHandle;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) return false;
  if (aclPolicy.visibility === "public" && requestedPermission === ObjectPermission.READ) return true;
  if (!userId) return false;
  if (aclPolicy.owner === userId) return true;
  return false;
}
