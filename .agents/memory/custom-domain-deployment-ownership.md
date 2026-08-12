---
name: Custom domain deployment ownership
description: How to interpret an active custom domain when the current workspace has no active deployment metadata
---

An active public custom domain is not proof that the currently open workspace owns or serves it. If deployment metadata reports no active deployment, the domain must be traced independently and its project/deployment ownership verified before source changes or republishing.

**Why:** A workspace can report no deployment and no deployment logs while the public domain still serves a Google Frontend/Express application. Publishing from the wrong workspace would not change the observed production behavior.

**How to apply:** Record the current workspace deployment metadata first, then compare the domain's headers, API behavior, static asset behavior, and custom-domain mapping against the intended deployment. Treat the owner as unknown until the mapping is explicitly verified.