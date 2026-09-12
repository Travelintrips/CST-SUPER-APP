---
name: Managed artifact removal
description: Managed artifacts cannot be deleted through workflow APIs or ordinary artifact.toml edits.
---

Managed artifacts are owned by the Replit artifact registry. Their workflow can be stopped, but removal from the project selector must be performed through the Library sidebar's artifact delete action; `verifyAndReplaceArtifactToml` only supports same-ID replacements.

**Why:** The workflow API rejected removal as “managed by an artifact”, while the metadata replacement flow rejected changing the artifact ID.

**How to apply:** When a user asks to remove an artifact, stop its workflow if possible, then direct them to Library → the artifact menu → Delete artifact for permanent registry removal.