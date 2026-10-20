# DecoHUB Core Operational V1

Date:
2026-10-07

Validated commit:
876ae3944cf6a7f521371a434db74b54bad54a8c

Validated branch:
repair/gpt-core-rebuild

Immutable tag:
decohub-core-operational-v1

Recovery branch:
baseline/core-operational-v1

Final E2E run:
aedf4524-1f3c-41a1-a031-a8b9995ae53f

## Validation Matrix

```text
Core deterministic tests: 54/54 PASS
TypeScript: PASS
Real AccountProfile: PASS
Real Supervisor: PASS
Real Worker: PASS
Real agentapi: PASS
Workspace isolation: PASS
5/5 autonomous tasks: PASS
Supervisor auto review: PASS
Worker self correction: PASS
Conversation persistence: PASS
send-message reuse: PASS
No conversation explosion: PASS
Target tests: 32/32 PASS
Target build: PASS
Target Git clean: PASS
Manual state intervention during run: 0
```

DECOHUB_CORE_OPERATIONAL = true

---

## Core Invariants

1. `project_path` é autoridade.
2. Workspace/Git root/runtime cwd precisam coincidir.
3. Worker READY exige runtime real.
4. Heartbeat não cria conversation.
5. Scheduler não cria conversation.
6. Probe reutiliza conversation oculta.
7. Supervisor reutiliza conversation persistente.
8. Worker reutiliza active leaf.
9. Project mismatch usa controlled handoff.
10. PermissionDenied genérico não cria conversation.
11. Lease stale precisa de reconciliação segura.
12. Supervisor review precisa usar response boundary nova.
13. Nenhuma Task é aprovada artificialmente.
14. Não existe fallback fake.
15. Commits não podem ser duplicados.
16. requested_model e actual_model devem permanecer distintos.
17. Run só é COMPLETED após prova real.
