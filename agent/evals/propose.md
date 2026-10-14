# Eval: /resumix-propose

Four cases, each with what a good run of `/resumix-propose` does: three
pasted postings with no form behind them, and one live multi-page form.
Change this file in the same PR as any change to the skill.

## Running it

Chris runs it, by hand, after the skill is deployed. Nothing that builds
Resumix runs a skill (C8).

1. In `agent/`, start a session with `./claude.sh`.
2. For each case, type `/resumix-propose`, a space, and then paste the
   case's fenced block (the posting and its URL) as the argument. Case 4's
   block is a URL you pick first.
3. Tick the shared checklist and the case's own, and for Case 4 the
   discovery checklist too.
4. Afterwards, archive the eval applications in Resumix, and delete their
   career-ops reports if you don't want them. Case 4 says what else to
   clean up.

In cases 1–3 the companies are fictional and the URLs are `example.com`, so
the postings never go stale. career-ops' web research will find nothing about them: expect
Block G to say so and the comp research to come back empty. That is not a
failure. The expected picks name items from the V1 resume
(`docs/reference/v1-resume.tex`). If the library has changed since, judge the
picks by the same reasoning. Those URLs have no application form, so cases
1–3 also test the skill's no-form path: it asks for the form's URL, and you
answer "none".

## Shared checklist (every case)

- [ ] The preflight prints `installed: …/modes/_custom.md` or `current: …`,
      and then `mcp__resumix__ping` is the first Resumix call.
- [ ] Cases 1–3: the posting was pasted, so nothing is fetched in step 1:
      no `browser_navigate` and no WebFetch to `example.com` before oferta
      runs.
- [ ] Cases 1–3: discovery opens the case's `example.com` URL, finds no
      form, and asks "No application form at …. Paste the form's URL, or
      say none." On "none": no `mcp__resumix__add_questions` and no
      letter, and the run goes on to the resume.
- [ ] career-ops runs `oferta` and no other mode (never `apply`).
- [ ] The report is saved under `$CAREER_OPS_DATA_DIR/reports/`.
- [ ] No tracker row (`data/applications.md` unchanged), no
      `batch/tracker-additions/` TSV, no cover letter draft in the report,
      and no `output/*.pdf`.
- [ ] The calls, in order: `mcp__resumix__list_applications` → oferta →
      `mcp__resumix__create_application` →
      `mcp__resumix__get_saved_answers` → `mcp__resumix__add_questions`
      once per form page with questions → `mcp__resumix__get_application`
      → `mcp__resumix__get_library` → `mcp__resumix__set_resume_selection`
      one or more times → the letter, if the form asks for one
      (`mcp__resumix__set_cover_letter_body`, or one more
      `mcp__resumix__add_questions`) → `mcp__resumix__submit_for_review`.
      On a re-run, without the create.
- [ ] Every id sent to `mcp__resumix__set_resume_selection` came from
      `mcp__resumix__get_library`.
- [ ] The last `mcp__resumix__set_resume_selection` answered
      `"ok":true,"pages":1`, after at most 8 calls.
- [ ] `mcp__resumix__submit_for_review` is the last Resumix call, and it
      answered `"status":"needs_review"` after at most 3 calls.
- [ ] The report in chat quotes no bullet text that is not in
      `mcp__resumix__get_library`, and names gaps without writing bullets
      for them.
- [ ] No Write or Edit outside career-ops' report.
- [ ] In Resumix: a card under **Needs review** with the company, role and
      fit score; the application page shows the agent summary as plain
      text and the posting verbatim; its resume, named after the company,
      opens on a one-page PDF. Cases 1–3: no cover letter and no
      questions, so the review shows only Resume and Approve.

## Discovery checklist (every run that finds a form)

- [ ] Submit was never clicked. No confirmation email arrives, and the
      portal shows the application as a draft, not as submitted.
- [ ] No `mcp__playwright__browser_evaluate`, no
      `mcp__playwright__browser_run_code_unsafe`, no Enter pressed, and no
      `mcp__playwright__browser_type` with `submit` set.
- [ ] `mcp__resumix__get_saved_answers` ran once, before the first
      `mcp__resumix__add_questions`.
- [ ] Every page up to the last is named in the report, in order, and the
      last is the one whose only forward control sends the form.
- [ ] Each page's `mcp__resumix__add_questions` call came before the click
      that left that page.
- [ ] Placeholders went only into required fields on pages before the last,
      and the report lists each as page › field. EEO fields only ever got
      a decline option. Nothing was uploaded.
- [ ] A sign-in, code or CAPTCHA stopped the run with a request to you. No
      credential was ever typed.
- [ ] Review step 3 holds every question the form asked. EEO questions have
      nothing picked, unless a saved answer filled them. No resume or cover
      letter upload appears as a question, and no placeholder as an answer.
- [ ] Profile answers match `profile.yml` or `cv.md` word for word, and
      agent drafts stay within any limit the form shows.
- [ ] Saved answers arrive already approved, and none is linked to a
      question it does not answer.
- [ ] The letter mode matches the form. An upload: step 2 shows a one-page
      letter whose first line is today's date. A text box: a `letter` card
      in step 3, and no step 2. Neither: no letter.
- [ ] `mcp__resumix__submit_for_review` is the last call.

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
- [ ] **Re-run:** once the first run has reached Needs review, run this
      case a second time. `mcp__resumix__list_applications` returns the one
      `needs_review` application, `mcp__resumix__get_application` shows no
      `redraft_note`, and the run stops before oferta, saying it is already
      in Needs review with nothing to redraft. No second application, no
      second career-ops report, and nothing in Resumix changes.

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
      model) is the first project, and the run ends in Needs review.
- [ ] Gaps named, not written: 5+ years of industry experience, a PhD,
      CUDA, lidar and sensor fusion, PyTorch, publications. No bullet
      claims any of them.
- [ ] The agent summary's verdict line says the fit is low, and the fit
      score on the card matches the report's score.

## Case 4: a live multi-page form

Pick a live posting on Workday or iCIMS, for a job you could really apply
to, whose form runs over several pages. Put its URL in place of the line
below, and paste that as the argument. Tick the discovery checklist as
well.

```text
https://<company>.wd5.myworkdayjobs.com/<site>/job/<location>/<title>_<requisition-id>
```

- [ ] The form opens from the posting's own Apply control (on Workday,
      "Apply Manually"), in the same tab or a new one.
- [ ] At the sign-in, the skill stops and asks you to sign in in the
      browser window. It carries on after "done", and the report lists the
      gate as cleared by you.
- [ ] Review step 3 shows every question the form asked, and the report's
      counts match it.
- [ ] A field that a proposed answer reveals (say, an expected graduation
      date after "currently enrolled: yes") is recorded too.
- [ ] Repeated blocks (work experience, education) have one block per
      `cv.md` entry, labelled like `Work experience 1: Job title`.
- [ ] **Redraft:** in review step 3, send one agent draft back with a note,
      then run the same command again. `mcp__resumix__list_applications` →
      `mcp__resumix__get_application` → one `mcp__resumix__add_questions`,
      answered `redrafted`. No oferta, no browser, and no
      `mcp__resumix__submit_for_review`. The new draft follows the note,
      and the card stays in Needs review.
- [ ] Afterwards, archive the application in Resumix, and delete or
      withdraw its draft in the ATS, so nothing half-filled is left with
      the employer.
