/**
 * Typed transcription of docs/reference/v1-resume.tex, kept separate from the
 * insert logic in scripts/seed.ts (T5).
 *
 * This is the exact same content the v1 round-trip fixture in
 * lib/render/render.test.ts uses (`v1Library`) — transcribed once there, and
 * reused here verbatim rather than re-keyed by hand, to avoid a second chance
 * for a typo to sneak into the one dataset the whole project's "represent my
 * current resume" acceptance bar depends on.
 *
 * Content is raw LaTeX, unescaped (see docs/DECISIONS.md D-008): `\textbf{}`,
 * `\href{}{\underline{}}`, `\$`, `\&`, `\%`, and any trailing spaces the
 * original author typed are all part of the data.
 *
 * No ids here — the database generates them on insert. scripts/seed.ts
 * threads the returned ids through to build the bridge rows.
 */

export interface SeedBullet {
  content: string;
}

export interface SeedExperience {
  company: string;
  title: string;
  dateRange: string;
  location: string;
  bullets: SeedBullet[];
}

export interface SeedProject {
  name: string;
  technologies: string;
  dateRange: string;
  bullets: SeedBullet[];
}

export interface SeedSkill {
  name: string;
}

export interface SeedSkillRow {
  name: string;
  top: boolean;
  separator: string;
  skills: SeedSkill[];
}

export const V1_EXPERIENCES: SeedExperience[] = [
  {
    company: 'Via Separations (NExT Consulting)',
    title: 'Software Engineer',
    dateRange: 'July 2025---December 2025',
    location: 'Boston, MA',
    bullets: [
      {
        content:
          'Designed and implemented a production Warehouse Management System for \\textbf{250+} users using \\textbf{Python} / \\textbf{React}, to track and manage biotech inventory across multiple facilities,  improving accuracy from \\textbf{50\\%} to \\textbf{95\\%} for \\textbf{10k+} items',
      },
      {
        content:
          'Architected PostgreSQL schema with temporal row versioning and genealogy tracking for complete traceability across \\textbf{100k+} rows. Utlized SQL Triggers, computed columns, and optimized queries to achieve \\textbf{2x} faster performance',
      },
      {
        content:
          'Implemented Entity-Attribute-Value (EAV) model to flexibly store \\textbf{1000+} custom attributes for biotech products',
      },
      {
        content:
          'Integrated with \\textbf{Quickbase API} to automatically fullfill purchase orders, increasing inventory intake speed by \\textbf{40\\%}',
      },
    ],
  },
  {
    company: 'Northeastern Electric Racing',
    title: 'Head of Web Development',
    dateRange: 'January 2024---Present',
    location: 'Boston, MA',
    bullets: [
      {
        content:
          'Manage all development and technical operations on an \\href{https://finishlinebyner.com/}{\\underline{Enterprise Resource Planning (ERP) system}} serving \\textbf{400+} club members, overseeing deployments on \\textbf{AWS}, codebase architecture, and feature roadmap execution',
      },
      {
        content:
          'Lead \\textbf{9} tech leads and \\textbf{60+} developers to implement multiple concurrent features each semester. Run weekly meetings, perform code reviews, provide technical help, and teach web dev onboarding class for \\textbf{30+} novice developers ',
      },
      {
        content:
          'Designed and implemented full AWS infrastructure with \\textbf{Terraform}, automated deployments, reduced costs by \\textbf{30\\%}',
      },
      {
        content:
          'Implemented a file review system where users can upload, view, markup, and approve drawings for CAD parts',
      },
      {
        content:
          'Refactored and optimized \\textbf{100+} endpoints and added indexing on database causing up to \\textbf{5x} faster page load times',
      },
    ],
  },
  {
    company: 'Unicode',
    title: 'Software Engineer',
    dateRange: 'August 2022---Present',
    location: 'Virtual',
    bullets: [
      {
        content:
          'Developed backend for the \\href{https://aac.unicode.org/adopt/}{\\underline{Adopt A Character}} site in \\textbf{Svelte}, involving schema design, payment processing, and integration with internal and external databases. Generated \\textbf{\\$40,000} revenue in the first \\textbf{2.5 months} of deployment',
      },
      {
        content:
          'Implemented backend flow with \\textbf{PouchDB} / \\textbf{Typescript} to check availability, process payments, and add adoptions',
      },
      {
        content:
          'Created Admin page to streamline adoption approval and automate social media posts \\& sending thank you emails',
      },
      {
        content:
          'Integrated with stripe payment and external accounting tool \\textbf{API} \\& \\textbf{Webhooks} to maintain data consistency',
      },
      {
        content:
          'Facilitated conversion of CLDR site with \\textbf{130+} pages into a static site, automated conversion with Python',
      },
    ],
  },
];

export const V1_PROJECTS: SeedProject[] = [
  {
    name: 'Mentor Matcher',
    technologies: 'React, Django',
    dateRange: 'August 2025',
    bullets: [
      {
        content:
          'Full stack staff mentorship matching application in \\textbf{React} and \\textbf{Django} with a customizable form and algorithm',
      },
      {
        content:
          'Utilized custom 3-stage matching algorithm to compare matches and compute optimal match pairings for whole cohort',
      },
    ],
  },
  {
    name: 'Bit board Chess Engine',
    technologies: 'C, GO, Web Sockets ',
    dateRange: 'June 2025',
    bullets: [
      {
        content:
          'Created bit board chess engine in \\textbf{C} with alpha beta pruning, iterative deepening, and search extensions',
      },
      {
        content:
          'Deployed engine in full-stack web app using \\textbf{React}, \\textbf{Web Sockets}, and \\textbf{Golang} to interface with the engine ',
      },
    ],
  },
  {
    name: 'Alpine Skiing Image Processor',
    technologies: 'Python, Yolov8, PyQt5',
    dateRange: 'January 2025',
    bullets: [
      {
        content:
          'Trained \\textbf{computer vision model} on custom dataset to automatically recognize bib numbers of ski racers in photos',
      },
      {
        content:
          'Developed user interface for bulk processing \\textbf{400+} photos / week, generating \\textbf{\\$600+} in sales revenue ',
      },
    ],
  },
];

export const V1_SKILL_ROWS: SeedSkillRow[] = [
  {
    name: 'Languages',
    top: true,
    separator: ', ',
    skills: [
      { name: 'JavaScript' },
      { name: 'Typescript' },
      { name: 'Python' },
      { name: 'Java' },
      { name: 'Rust' },
      { name: 'C' },
      { name: 'C++' },
      { name: 'SQL' },
      { name: 'Terraform' },
      { name: 'HTML' },
      { name: 'CSS' },
      // Trailing space transcribed verbatim from the reference file ("Racket } \\"):
      // D-008 is content-verbatim, so a stray space the original author typed is
      // part of the data.
      { name: 'Racket ' },
    ],
  },
  {
    name: 'Frameworks \\& Tools',
    top: true,
    separator: ', ',
    skills: [
      { name: 'Git' },
      { name: 'Docker' },
      { name: 'React' },
      { name: 'Node' },
      { name: 'Express' },
      { name: 'Prisma' },
      { name: 'FastAPI' },
      { name: 'SQLAlchemy' },
      { name: 'Django' },
      { name: 'FreeRTOS' },
    ],
  },
  {
    name: 'Cloud Technologies',
    top: true,
    separator: ', ',
    skills: [
      { name: 'Github Actions' },
      { name: 'AWS (EB, ECS, EC2, S3, RDS, Amplify, DynamoDB)' },
      { name: 'Netlify' },
      // Same trailing-space transcription as "Racket " above.
      { name: 'Vercel ' },
    ],
  },
  {
    name: 'Interests',
    top: false,
    separator: ' $|$ ',
    skills: [
      { name: 'Skiing' },
      { name: 'Ski Racing' },
      { name: 'Mountain Biking' },
      { name: 'Rock Climbing' },
      { name: 'Hiking' },
      { name: 'Car Racing' },
      { name: 'Cats' },
      { name: 'Weightlifting' },
      { name: 'Cooking' },
    ],
  },
  {
    name: 'Accolades',
    top: false,
    separator: ' $|$ ',
    skills: [
      { name: 'Deans List all semesters' },
      { name: 'Red Cross CPR \\& First Aid' },
      { name: 'Bill Taylor Essay Contest Winner' },
      { name: 'Cum Laude' },
    ],
  },
];
