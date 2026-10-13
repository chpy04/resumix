# Eval: /resumix-propose

Three postings, each with what a good run of `/resumix-propose` does. Change
this file in the same PR as any change to the skill.

## Running it

Chris runs it, by hand, after the skill is deployed. Nothing that builds
Resumix runs a skill (C8).

1. In `agent/`, start a session with `./claude.sh`.
2. For each case, type `/resumix-propose`, a space, and then paste the
   case's fenced block (the posting and its URL) as the argument.
3. Tick the shared checklist and the case's own.
4. Afterwards, archive the eval applications in Resumix (their companies
   are made up), and delete their career-ops reports if you don't want them.

The companies are fictional and the URLs are `example.com`, so the postings
never go stale. career-ops' web research will find nothing about them: expect
Block G to say so and the comp research to come back empty. That is not a
failure. The expected picks name items from the V1 resume
(`docs/reference/v1-resume.tex`). If the library has changed since, judge the
picks by the same reasoning.

## Shared checklist (every case)

- [ ] The preflight prints `installed: …/modes/_custom.md` or `current: …`,
      and then `mcp__resumix__ping` is the first Resumix call.
- [ ] The posting was pasted, so nothing is navigated or fetched: no
      `browser_navigate` and no WebFetch to `example.com`.
- [ ] career-ops runs `oferta` and no other mode.
- [ ] The report is saved under `$CAREER_OPS_DATA_DIR/reports/`.
- [ ] No tracker row (`data/applications.md` unchanged), no
      `batch/tracker-additions/` TSV, no cover letter draft in the report,
      and no `output/*.pdf`.
- [ ] The Resumix calls, in order: `mcp__resumix__list_applications` →
      `mcp__resumix__create_application` → `mcp__resumix__get_application`
      → `mcp__resumix__get_library` → `mcp__resumix__set_resume_selection`
      one or more times (on a re-run, without the create).
- [ ] Every id sent to `mcp__resumix__set_resume_selection` came from
      `mcp__resumix__get_library`.
- [ ] The last `mcp__resumix__set_resume_selection` answered
      `"ok":true,"pages":1`, after at most 8 calls.
- [ ] The report in chat quotes no bullet text that is not in
      `mcp__resumix__get_library`, and names gaps without writing bullets
      for them.
- [ ] No Write or Edit outside career-ops' report.
- [ ] In Resumix: a card under **Proposing** with the company, role and fit
      score; the application page shows the agent summary as plain text and
      the posting verbatim; its resume, named after the company, opens on a
      one-page PDF. No cover letter, nothing in Needs review.

## Case 1: platform and infrastructure intern

```text
https://example.com/resumix-eval/1

Tidewater Relay: Software Engineer Intern, Platform (Summer–Fall 2026)
Boston, MA (hybrid, 3 days in office)

Tidewater Relay runs the real-time messaging layer behind live sports
scoreboards: millions of websocket connections, fanned out from a small
fleet of Go services.

What you'll do
- Build and operate backend services in Go that hold long-lived websocket
  connections.
- Work on the C library our edge nodes use to encode and diff game state.
- Ship infrastructure as code: Docker images, Terraform for AWS (ECS, RDS,
  S3), and CI in GitHub Actions.
- Profile and speed up hot paths, from database queries to the wire format.

What we're looking for
- Pursuing a BS in Computer Science or similar, available May–December 2026.
- Strong in at least one of Go, C or C++; comfortable with SQL.
- Experience with Docker and Terraform, or with AWS deployments.
- You have shipped something real-time: a game server, a chat app, a
  multiplayer engine.

Pay: $42–48/hour. Relocation help available.
```

- [ ] Expect a score of 4.0 or above, so nothing is asked before creating.
      (If career-ops scores it lower, asking first is right.)
- [ ] Bit board Chess Engine is the first project (C, Go, websockets).
- [ ] Electric Racing's Terraform/AWS bullet, and Via Separations' PostgreSQL
      performance bullet, sit high under their experiences.
- [ ] C, Terraform, Docker and GitHub Actions move to the front of their
      skill rows. Go is not added as a skill (the library has no such skill);
      it shows only through the chess engine's technologies.
- [ ] Gaps named, not written: none of the library's bullets mention Go
      services in production, or on-call work.
- [ ] **Re-run:** run this case a second time. `mcp__resumix__list_applications`
      returns the one `proposing` application, it is reused, no second
      application appears, and `mcp__resumix__set_resume_selection` runs on
      the same `application_id`.

## Case 2: forward-deployed engineer intern

```text
https://example.com/resumix-eval/2

Brightfold: Forward Deployed Engineer Intern
Boston or New York (in office)

Brightfold sells workflow software to hospital operations teams, and our
forward-deployed engineers sit with each customer to make it fit. You'll
spend half your week with the people who use what you build.

What you'll do
- Lead discovery sessions with customer staff, turn what you hear into
  working prototypes within days, and iterate with them on site.
- Build full-stack features in React and TypeScript on top of our Python
  (Django and FastAPI) services.
- Integrate customer systems over REST APIs and webhooks.
- Teach customer admins to run what you ship.

What we're looking for
- Pursuing a BS in Computer Science or similar, available May–December 2026.
- Full-stack experience with React and TypeScript, and Python on the backend.
- You have led people: a team, a club, a class you taught.
- Clear writing and calm with non-technical users.

Pay: $40–46/hour.
```

- [ ] Expect a score of 4.0 or above, so nothing is asked before creating.
      (If career-ops scores it lower, asking first is right.)
- [ ] Under Electric Racing, the leadership bullet (9 tech leads, 60+
      developers, onboarding class) comes first.
- [ ] Mentor Matcher (React, Django) is the first project.
- [ ] Via Separations' Python/React warehouse system bullet and Unicode's
      Stripe API and webhooks bullet are kept, high under their experiences.
- [ ] React, Typescript, Python, Django and FastAPI move to the front of
      their skill rows.
- [ ] Gaps named, not written: nothing in the library shows work with
      healthcare customers.

## Case 3: senior ML perception engineer (low fit, on purpose)

```text
https://example.com/resumix-eval/3

Halvard Perception: Senior Machine Learning Engineer, Perception
Pittsburgh, PA (on site)

Halvard builds the perception stack for autonomous agricultural vehicles.
You will own models that fuse camera and lidar data in real time on
embedded GPUs.

What you'll do
- Design, train and deploy 3D object detection and tracking models.
- Write and optimise CUDA kernels and C++ inference code for NVIDIA Jetson.
- Lead the team's sensor-fusion roadmap and mentor junior engineers.

What we're looking for
- 5+ years of industry experience in computer vision or robotics perception.
- A PhD in machine learning, robotics or a related field.
- Expert PyTorch and CUDA; production C++.
- Publications at CVPR, ICCV or similar.

Pay: $210,000–260,000 base, plus equity.
```

- [ ] The score is below 4.0, and the skill asks whether to propose it
      anyway **before** `mcp__resumix__create_application`, naming the
      gaps (5+ years, PhD, CUDA). Answering "no" ends the run with nothing
      created in Resumix.
- [ ] On "yes": Alpine Skiing Image Processor (a trained computer vision
      model) is the first project.
- [ ] Gaps named, not written: 5+ years of industry experience, a PhD,
      CUDA, lidar and sensor fusion, PyTorch, publications. No bullet
      claims any of them.
- [ ] The agent summary's verdict line says the fit is low, and the fit
      score on the card matches the report's score.
