import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Library, Selections } from '../types.ts';
import { renderResume } from './index.ts';
import { renderExperiences, renderProjects, renderSkills } from './sections.ts';
import { substituteTokens } from './tokens.ts';
import { DEFAULT_TEMPLATE } from './default-template.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Small, hand-built fixtures for the focused unit tests below.
// ---------------------------------------------------------------------------

function emptySelections(): Selections {
  return { experiences: [], experienceBullets: {}, projects: [], projectBullets: {}, skillRows: [], skills: {} };
}

function emptyLibrary(): Library {
  return { experiences: [], projects: [], skillRows: [], templates: [] };
}

// ---------------------------------------------------------------------------
// Ordering / selection semantics
// ---------------------------------------------------------------------------

test('experiences render in Selections order, not library order', () => {
  const library = emptyLibrary();
  library.experiences = [
    { id: 'b', company: 'Company B', title: 'Title B', dateRange: '2020', location: 'X', isArchived: false, bullets: [] },
    { id: 'a', company: 'Company A', title: 'Title A', dateRange: '2021', location: 'Y', isArchived: false, bullets: [] },
  ];
  const selections = emptySelections();
  selections.experiences = ['a', 'b']; // reversed relative to library array order

  const warnings: string[] = [];
  const out = renderExperiences(library, selections, warnings);

  assert.ok(out.indexOf('Title A') < out.indexOf('Title B'), 'Selections order should win over library array order');
});

test('an experience absent from Selections does not render', () => {
  const library = emptyLibrary();
  library.experiences = [
    { id: 'a', company: 'Company A', title: 'Kept', dateRange: '2021', location: 'Y', isArchived: false, bullets: [] },
    { id: 'b', company: 'Company B', title: 'Dropped', dateRange: '2020', location: 'X', isArchived: false, bullets: [] },
  ];
  const selections = emptySelections();
  selections.experiences = ['a'];

  const warnings: string[] = [];
  const out = renderExperiences(library, selections, warnings);

  assert.match(out, /Kept/);
  assert.doesNotMatch(out, /Dropped/);
});

// ---------------------------------------------------------------------------
// Zero-bullet items
// ---------------------------------------------------------------------------

test('an experience with zero selected bullets renders the heading and omits the item list, with a warning', () => {
  const library = emptyLibrary();
  library.experiences = [
    {
      id: 'a',
      company: 'Acme',
      title: 'Bare Heading',
      dateRange: '2021',
      location: 'Remote',
      isArchived: false,
      bullets: [{ id: 'a-b1', content: 'Not selected', isArchived: false }],
    },
  ];
  const selections = emptySelections();
  selections.experiences = ['a'];
  selections.experienceBullets = { a: [] };

  const warnings: string[] = [];
  const out = renderExperiences(library, selections, warnings);

  assert.match(out, /\\resumeSubheading\{Bare Heading\}/);
  assert.doesNotMatch(out, /resumeItemListStart/);
  assert.doesNotMatch(out, /resumeItemListEnd/);
  assert.ok(
    warnings.some((w) => w.includes('a') && w.includes('no selected bullets')),
    `expected a zero-bullet warning, got: ${JSON.stringify(warnings)}`,
  );
});

test('a project with zero selected bullets renders the heading and omits the item list, with a warning', () => {
  const library = emptyLibrary();
  library.projects = [
    {
      id: 'p',
      name: 'Bare Project',
      technologies: 'Rust',
      dateRange: '2021',
      isArchived: false,
      bullets: [{ id: 'p-b1', content: 'Not selected', isArchived: false }],
    },
  ];
  const selections = emptySelections();
  selections.projects = ['p'];
  // projectBullets['p'] intentionally absent entirely, not just empty

  const warnings: string[] = [];
  const out = renderProjects(library, selections, warnings);

  assert.match(out, /\\resumeProjectHeading\{Bare Project\}/);
  assert.doesNotMatch(out, /resumeItemListStart/);
  assert.ok(warnings.some((w) => w.includes('no selected bullets')));
});

// ---------------------------------------------------------------------------
// Archiving does not suppress rendering (D-011)
// ---------------------------------------------------------------------------

test('an archived experience that is still selected renders exactly as a non-archived one would', () => {
  const library = emptyLibrary();
  library.experiences = [
    {
      id: 'a',
      company: 'Retired Co',
      title: 'Archived But Selected',
      dateRange: '2019',
      location: 'Nowhere',
      isArchived: true,
      bullets: [{ id: 'a-b1', content: 'Still shows up', isArchived: false }],
    },
  ];
  const selections = emptySelections();
  selections.experiences = ['a'];
  selections.experienceBullets = { a: ['a-b1'] };

  const warnings: string[] = [];
  const out = renderExperiences(library, selections, warnings);

  assert.match(out, /Archived But Selected/);
  assert.match(out, /Still shows up/);
  assert.ok(
    !warnings.some((w) => /archiv/i.test(w)),
    `isArchived must not itself produce a warning, got: ${JSON.stringify(warnings)}`,
  );
});

test('an archived bullet that is still selected renders too', () => {
  const library = emptyLibrary();
  library.experiences = [
    {
      id: 'a',
      company: 'Co',
      title: 'Title',
      dateRange: '2019',
      location: 'Nowhere',
      isArchived: false,
      bullets: [{ id: 'a-b1', content: 'Archived bullet content', isArchived: true }],
    },
  ];
  const selections = emptySelections();
  selections.experiences = ['a'];
  selections.experienceBullets = { a: ['a-b1'] };

  const warnings: string[] = [];
  const out = renderExperiences(library, selections, warnings);

  assert.match(out, /Archived bullet content/);
});

// ---------------------------------------------------------------------------
// Dangling ids never throw
// ---------------------------------------------------------------------------

test('a dangling experience id is skipped with a warning instead of throwing', () => {
  const library = emptyLibrary();
  const selections = emptySelections();
  selections.experiences = ['does-not-exist'];

  const warnings: string[] = [];
  assert.doesNotThrow(() => renderExperiences(library, selections, warnings));
  const out = renderExperiences(library, selections, warnings);
  assert.equal(out, '');
  assert.ok(warnings.some((w) => w.includes('does-not-exist')));
});

test('a dangling bullet id within a selected experience is skipped with a warning', () => {
  const library = emptyLibrary();
  library.experiences = [
    {
      id: 'a',
      company: 'Co',
      title: 'Title',
      dateRange: '2019',
      location: 'Nowhere',
      isArchived: false,
      bullets: [{ id: 'a-b1', content: 'Real bullet', isArchived: false }],
    },
  ];
  const selections = emptySelections();
  selections.experiences = ['a'];
  selections.experienceBullets = { a: ['a-b1', 'ghost-bullet'] };

  const warnings: string[] = [];
  const out = renderExperiences(library, selections, warnings);

  assert.match(out, /Real bullet/);
  assert.ok(warnings.some((w) => w.includes('ghost-bullet')));
});

test('renderResume never throws end-to-end when Selections reference stale ids', () => {
  const library = emptyLibrary();
  const selections = emptySelections();
  selections.experiences = ['ghost'];
  selections.projects = ['ghost'];
  selections.skillRows = ['ghost'];

  assert.doesNotThrow(() => {
    const { warnings } = renderResume({ templateContent: '<<EXPERIENCES>><<PROJECTS>><<SKILLS_TOP>><<SKILLS_BOTTOM>>', library, selections });
    assert.ok(warnings.length >= 3);
  });
});

// ---------------------------------------------------------------------------
// Unknown tokens
// ---------------------------------------------------------------------------

test('an unknown token is left verbatim in the output and produces a warning', () => {
  const warnings: string[] = [];
  const out = substituteTokens('before <<NOT_A_REAL_TOKEN>> after', { EXPERIENCES: '' }, warnings);

  assert.equal(out, 'before <<NOT_A_REAL_TOKEN>> after');
  assert.ok(warnings.some((w) => w.includes('NOT_A_REAL_TOKEN')));
});

test('a known token is substituted at every occurrence', () => {
  const warnings: string[] = [];
  const out = substituteTokens('<<X>>-<<X>>-<<X>>', { X: 'Y' }, warnings);
  assert.equal(out, 'Y-Y-Y');
  assert.equal(warnings.length, 0);
});

test('an unknown token repeated in the template only warns once', () => {
  const warnings: string[] = [];
  substituteTokens('<<X>> <<X>>', {}, warnings);
  assert.equal(warnings.filter((w) => w.includes('X')).length, 1);
});

// ---------------------------------------------------------------------------
// Skills: top/bottom split, empty rows
// ---------------------------------------------------------------------------

test('a selected skill row appears in exactly one of SKILLS_TOP / SKILLS_BOTTOM, per its own top flag', () => {
  const library = emptyLibrary();
  library.skillRows = [
    { id: 'top-row', name: 'Languages', top: true, separator: ', ', isArchived: false, skills: [{ id: 's1', name: 'Rust', isArchived: false }] },
    { id: 'bottom-row', name: 'Interests', top: false, separator: ', ', isArchived: false, skills: [{ id: 's2', name: 'Skiing', isArchived: false }] },
  ];
  const selections = emptySelections();
  selections.skillRows = ['top-row', 'bottom-row'];
  selections.skills = { 'top-row': ['s1'], 'bottom-row': ['s2'] };

  const warnings: string[] = [];
  const { top, bottom } = renderSkills(library, selections, warnings);

  assert.match(top, /Languages/);
  assert.doesNotMatch(top, /Interests/);
  assert.match(bottom, /Interests/);
  assert.doesNotMatch(bottom, /Languages/);
});

test('a skill row with zero selected skills is skipped entirely, with a warning', () => {
  const library = emptyLibrary();
  library.skillRows = [
    { id: 'empty-row', name: 'Languages', top: true, separator: ', ', isArchived: false, skills: [{ id: 's1', name: 'Rust', isArchived: false }] },
  ];
  const selections = emptySelections();
  selections.skillRows = ['empty-row'];
  selections.skills = { 'empty-row': [] };

  const warnings: string[] = [];
  const { top, bottom } = renderSkills(library, selections, warnings);

  assert.equal(top, '');
  assert.equal(bottom, '');
  assert.ok(warnings.some((w) => w.includes('empty-row') && w.includes('no selected skills')));
});

test('a dangling skill id within a row is skipped with a warning; the rest of the row still renders', () => {
  const library = emptyLibrary();
  library.skillRows = [
    {
      id: 'row',
      name: 'Languages',
      top: true,
      separator: ', ',
      isArchived: false,
      skills: [{ id: 's1', name: 'Rust', isArchived: false }],
    },
  ];
  const selections = emptySelections();
  selections.skillRows = ['row'];
  selections.skills = { row: ['s1', 'ghost-skill'] };

  const warnings: string[] = [];
  const { top } = renderSkills(library, selections, warnings);

  assert.match(top, /Rust/);
  assert.ok(warnings.some((w) => w.includes('ghost-skill')));
});

test('multiple selected rows in the same section join with " \\\\\\n" and no trailing separator', () => {
  const library = emptyLibrary();
  library.skillRows = [
    { id: 'r1', name: 'Languages', top: true, separator: ', ', isArchived: false, skills: [{ id: 's1', name: 'Rust', isArchived: false }] },
    { id: 'r2', name: 'Tools', top: true, separator: ', ', isArchived: false, skills: [{ id: 's2', name: 'Git', isArchived: false }] },
  ];
  const selections = emptySelections();
  selections.skillRows = ['r1', 'r2'];
  selections.skills = { r1: ['s1'], r2: ['s2'] };

  const warnings: string[] = [];
  const { top } = renderSkills(library, selections, warnings);

  assert.equal(top, '\\textbf{Languages}{: Rust} \\\\\n\\textbf{Tools}{: Git}');
});


// ---------------------------------------------------------------------------
// The v1 round trip: the project's smoke test.
//
// Fixtures below transcribe the exact content of docs/reference/v1-resume.tex
// (3 experiences, 3 projects, 3 top skill rows, 2 bottom rows) into Library +
// Selections, all fully selected in the same order they appear in the file.
// Rendering that against default-template.ts should reproduce the reference
// file, modulo insignificant whitespace and one documented, expected
// divergence (see below).
// ---------------------------------------------------------------------------

const v1Library: Library = {
  experiences: [
    {
      id: 'exp-1',
      company: "Via Separations (NExT Consulting)",
      title: "Software Engineer",
      dateRange: "July 2025---December 2025",
      location: "Boston, MA",
      isArchived: false,
      bullets: [
        { id: 'exp-1-b1', content: "Designed and implemented a production Warehouse Management System for \\textbf{250+} users using \\textbf{Python} / \\textbf{React}, to track and manage biotech inventory across multiple facilities,  improving accuracy from \\textbf{50\\%} to \\textbf{95\\%} for \\textbf{10k+} items", isArchived: false },
        { id: 'exp-1-b2', content: "Architected PostgreSQL schema with temporal row versioning and genealogy tracking for complete traceability across \\textbf{100k+} rows. Utlized SQL Triggers, computed columns, and optimized queries to achieve \\textbf{2x} faster performance", isArchived: false },
        { id: 'exp-1-b3', content: "Implemented Entity-Attribute-Value (EAV) model to flexibly store \\textbf{1000+} custom attributes for biotech products", isArchived: false },
        { id: 'exp-1-b4', content: "Integrated with \\textbf{Quickbase API} to automatically fullfill purchase orders, increasing inventory intake speed by \\textbf{40\\%}", isArchived: false },
      ],
    },
    {
      id: 'exp-2',
      company: "Northeastern Electric Racing",
      title: "Head of Web Development",
      dateRange: "January 2024---Present",
      location: "Boston, MA",
      isArchived: false,
      bullets: [
        { id: 'exp-2-b1', content: "Manage all development and technical operations on an \\href{https://finishlinebyner.com/}{\\underline{Enterprise Resource Planning (ERP) system}} serving \\textbf{400+} club members, overseeing deployments on \\textbf{AWS}, codebase architecture, and feature roadmap execution", isArchived: false },
        { id: 'exp-2-b2', content: "Lead \\textbf{9} tech leads and \\textbf{60+} developers to implement multiple concurrent features each semester. Run weekly meetings, perform code reviews, provide technical help, and teach web dev onboarding class for \\textbf{30+} novice developers ", isArchived: false },
        { id: 'exp-2-b3', content: "Designed and implemented full AWS infrastructure with \\textbf{Terraform}, automated deployments, reduced costs by \\textbf{30\\%}", isArchived: false },
        { id: 'exp-2-b4', content: "Implemented a file review system where users can upload, view, markup, and approve drawings for CAD parts", isArchived: false },
        { id: 'exp-2-b5', content: "Refactored and optimized \\textbf{100+} endpoints and added indexing on database causing up to \\textbf{5x} faster page load times", isArchived: false },
      ],
    },
    {
      id: 'exp-3',
      company: "Unicode",
      title: "Software Engineer",
      dateRange: "August 2022---Present",
      location: "Virtual",
      isArchived: false,
      bullets: [
        { id: 'exp-3-b1', content: "Developed backend for the \\href{https://aac.unicode.org/adopt/}{\\underline{Adopt A Character}} site in \\textbf{Svelte}, involving schema design, payment processing, and integration with internal and external databases. Generated \\textbf{\\$40,000} revenue in the first \\textbf{2.5 months} of deployment", isArchived: false },
        { id: 'exp-3-b2', content: "Implemented backend flow with \\textbf{PouchDB} / \\textbf{Typescript} to check availability, process payments, and add adoptions", isArchived: false },
        { id: 'exp-3-b3', content: "Created Admin page to streamline adoption approval and automate social media posts \\& sending thank you emails", isArchived: false },
        { id: 'exp-3-b4', content: "Integrated with stripe payment and external accounting tool \\textbf{API} \\& \\textbf{Webhooks} to maintain data consistency", isArchived: false },
        { id: 'exp-3-b5', content: "Facilitated conversion of CLDR site with \\textbf{130+} pages into a static site, automated conversion with Python", isArchived: false },
      ],
    },
  ],
  projects: [
    {
      id: 'proj-1',
      name: "Mentor Matcher",
      technologies: "React, Django",
      dateRange: "August 2025",
      isArchived: false,
      bullets: [
        { id: 'proj-1-b1', content: "Full stack staff mentorship matching application in \\textbf{React} and \\textbf{Django} with a customizable form and algorithm", isArchived: false },
        { id: 'proj-1-b2', content: "Utilized custom 3-stage matching algorithm to compare matches and compute optimal match pairings for whole cohort", isArchived: false },
      ],
    },
    {
      id: 'proj-2',
      name: "Bit board Chess Engine",
      technologies: "C, GO, Web Sockets ",
      dateRange: "June 2025",
      isArchived: false,
      bullets: [
        { id: 'proj-2-b1', content: "Created bit board chess engine in \\textbf{C} with alpha beta pruning, iterative deepening, and search extensions", isArchived: false },
        { id: 'proj-2-b2', content: "Deployed engine in full-stack web app using \\textbf{React}, \\textbf{Web Sockets}, and \\textbf{Golang} to interface with the engine ", isArchived: false },
      ],
    },
    {
      id: 'proj-3',
      name: "Alpine Skiing Image Processor",
      technologies: "Python, Yolov8, PyQt5",
      dateRange: "January 2025",
      isArchived: false,
      bullets: [
        { id: 'proj-3-b1', content: "Trained \\textbf{computer vision model} on custom dataset to automatically recognize bib numbers of ski racers in photos", isArchived: false },
        { id: 'proj-3-b2', content: "Developed user interface for bulk processing \\textbf{400+} photos / week, generating \\textbf{\\$600+} in sales revenue ", isArchived: false },
      ],
    },
  ],
  skillRows: [
    {
      id: 'skillrow-top-1',
      name: "Languages",
      top: true,
      separator: ', ',
      isArchived: false,
      skills: [
        { id: 'skillrow-top-1-s1', name: "JavaScript", isArchived: false },
        { id: 'skillrow-top-1-s2', name: "Typescript", isArchived: false },
        { id: 'skillrow-top-1-s3', name: "Python", isArchived: false },
        { id: 'skillrow-top-1-s4', name: "Java", isArchived: false },
        { id: 'skillrow-top-1-s5', name: "Rust", isArchived: false },
        { id: 'skillrow-top-1-s6', name: "C", isArchived: false },
        { id: 'skillrow-top-1-s7', name: "C++", isArchived: false },
        { id: 'skillrow-top-1-s8', name: "SQL", isArchived: false },
        { id: 'skillrow-top-1-s9', name: "Terraform", isArchived: false },
        { id: 'skillrow-top-1-s10', name: "HTML", isArchived: false },
        { id: 'skillrow-top-1-s11', name: "CSS", isArchived: false },
        // Trailing space transcribed verbatim from the reference file ("Racket } \\"): D-008 is
        // content-verbatim, so a stray space the original author typed is part of the data.
        { id: 'skillrow-top-1-s12', name: "Racket ", isArchived: false },
      ],
    },
    {
      id: 'skillrow-top-2',
      name: "Frameworks \\& Tools",
      top: true,
      separator: ', ',
      isArchived: false,
      skills: [
        { id: 'skillrow-top-2-s1', name: "Git", isArchived: false },
        { id: 'skillrow-top-2-s2', name: "Docker", isArchived: false },
        { id: 'skillrow-top-2-s3', name: "React", isArchived: false },
        { id: 'skillrow-top-2-s4', name: "Node", isArchived: false },
        { id: 'skillrow-top-2-s5', name: "Express", isArchived: false },
        { id: 'skillrow-top-2-s6', name: "Prisma", isArchived: false },
        { id: 'skillrow-top-2-s7', name: "FastAPI", isArchived: false },
        { id: 'skillrow-top-2-s8', name: "SQLAlchemy", isArchived: false },
        { id: 'skillrow-top-2-s9', name: "Django", isArchived: false },
        { id: 'skillrow-top-2-s10', name: "FreeRTOS", isArchived: false },
      ],
    },
    {
      id: 'skillrow-top-3',
      name: "Cloud Technologies",
      top: true,
      separator: ', ',
      isArchived: false,
      skills: [
        { id: 'skillrow-top-3-s1', name: "Github Actions", isArchived: false },
        { id: 'skillrow-top-3-s2', name: "AWS (EB, ECS, EC2, S3, RDS, Amplify, DynamoDB)", isArchived: false },
        { id: 'skillrow-top-3-s3', name: "Netlify", isArchived: false },
        // Same trailing-space transcription as "Racket " above.
        { id: 'skillrow-top-3-s4', name: "Vercel ", isArchived: false },
      ],
    },
    {
      id: 'skillrow-bottom-1',
      name: "Interests",
      top: false,
      separator: ' $|$ ',
      isArchived: false,
      skills: [
        { id: 'skillrow-bottom-1-s1', name: "Skiing", isArchived: false },
        { id: 'skillrow-bottom-1-s2', name: "Ski Racing", isArchived: false },
        { id: 'skillrow-bottom-1-s3', name: "Mountain Biking", isArchived: false },
        { id: 'skillrow-bottom-1-s4', name: "Rock Climbing", isArchived: false },
        { id: 'skillrow-bottom-1-s5', name: "Hiking", isArchived: false },
        { id: 'skillrow-bottom-1-s6', name: "Car Racing", isArchived: false },
        { id: 'skillrow-bottom-1-s7', name: "Cats", isArchived: false },
        { id: 'skillrow-bottom-1-s8', name: "Weightlifting", isArchived: false },
        { id: 'skillrow-bottom-1-s9', name: "Cooking", isArchived: false },
      ],
    },
    {
      id: 'skillrow-bottom-2',
      name: "Accolades",
      top: false,
      separator: ' $|$ ',
      isArchived: false,
      skills: [
        { id: 'skillrow-bottom-2-s1', name: "Deans List all semesters", isArchived: false },
        { id: 'skillrow-bottom-2-s2', name: "Red Cross CPR \\& First Aid", isArchived: false },
        { id: 'skillrow-bottom-2-s3', name: "Bill Taylor Essay Contest Winner", isArchived: false },
        { id: 'skillrow-bottom-2-s4', name: "Cum Laude", isArchived: false },
      ],
    },
  ],
  templates: [],
};

const v1Selections: Selections = {
  experiences: ['exp-1', 'exp-2', 'exp-3'],
  experienceBullets: {
    'exp-1': ['exp-1-b1', 'exp-1-b2', 'exp-1-b3', 'exp-1-b4'],
    'exp-2': ['exp-2-b1', 'exp-2-b2', 'exp-2-b3', 'exp-2-b4', 'exp-2-b5'],
    'exp-3': ['exp-3-b1', 'exp-3-b2', 'exp-3-b3', 'exp-3-b4', 'exp-3-b5'],
  },
  projects: ['proj-1', 'proj-2', 'proj-3'],
  projectBullets: {
    'proj-1': ['proj-1-b1', 'proj-1-b2'],
    'proj-2': ['proj-2-b1', 'proj-2-b2'],
    'proj-3': ['proj-3-b1', 'proj-3-b2'],
  },
  skillRows: ['skillrow-top-1', 'skillrow-top-2', 'skillrow-top-3', 'skillrow-bottom-1', 'skillrow-bottom-2'],
  skills: {
    'skillrow-top-1': ['skillrow-top-1-s1', 'skillrow-top-1-s2', 'skillrow-top-1-s3', 'skillrow-top-1-s4', 'skillrow-top-1-s5', 'skillrow-top-1-s6', 'skillrow-top-1-s7', 'skillrow-top-1-s8', 'skillrow-top-1-s9', 'skillrow-top-1-s10', 'skillrow-top-1-s11', 'skillrow-top-1-s12'],
    'skillrow-top-2': ['skillrow-top-2-s1', 'skillrow-top-2-s2', 'skillrow-top-2-s3', 'skillrow-top-2-s4', 'skillrow-top-2-s5', 'skillrow-top-2-s6', 'skillrow-top-2-s7', 'skillrow-top-2-s8', 'skillrow-top-2-s9', 'skillrow-top-2-s10'],
    'skillrow-top-3': ['skillrow-top-3-s1', 'skillrow-top-3-s2', 'skillrow-top-3-s3', 'skillrow-top-3-s4'],
    'skillrow-bottom-1': ['skillrow-bottom-1-s1', 'skillrow-bottom-1-s2', 'skillrow-bottom-1-s3', 'skillrow-bottom-1-s4', 'skillrow-bottom-1-s5', 'skillrow-bottom-1-s6', 'skillrow-bottom-1-s7', 'skillrow-bottom-1-s8', 'skillrow-bottom-1-s9'],
    'skillrow-bottom-2': ['skillrow-bottom-2-s1', 'skillrow-bottom-2-s2', 'skillrow-bottom-2-s3', 'skillrow-bottom-2-s4'],
  },
};

/**
 * Collapses whitespace that has no effect on the compiled LaTeX output:
 * TeX's tokenizer skips leading spaces at the start of every line (state N),
 * and any run of consecutive spaces is equivalent to a single space. Blank
 * lines (paragraph breaks) are preserved as-is.
 */
function normalizeInsignificantWhitespace(tex: string): string {
  return tex
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .join('\n')
    .trim();
}

const scratchDir = join(__dirname, '.scratch');
const referencePath = join(__dirname, '../../docs/reference/v1-resume.tex');
const renderedOutputPath = join(scratchDir, 'v1-round-trip-output.tex');

test('round trip: default template + full v1 fixture reproduces docs/reference/v1-resume.tex', () => {
  const referenceRaw = readFileSync(referencePath, 'utf8');

  const { tex, warnings } = renderResume({
    templateContent: DEFAULT_TEMPLATE,
    library: v1Library,
    selections: v1Selections,
  });

  mkdirSync(scratchDir, { recursive: true });
  writeFileSync(renderedOutputPath, tex);

  assert.deepEqual(warnings, [], `expected a clean render of the full v1 fixture, got warnings: ${JSON.stringify(warnings)}`);

  // The reference hand-template contains one commented-out placeholder bullet
  // inside Experience #1's item list (a LaTeX comment the original author left
  // as a note-to-self). LaTeX comments have zero effect on the compiled
  // document, and the render engine has no concept of "a comment living
  // inside token-owned content" -- the whole bullet list there is data-driven
  // -- so this line is expected to be absent from the render. It is the one
  // documented divergence in this round trip.
  const documentedDivergence =
    '  % \\resumeItem{Built \\textbf{AWS} infrastructure (EC2, RDS, S3) using \\textbf{Terraform} and automated deployments with \\textbf{CI/CD pipeline}}\n';
  assert.ok(referenceRaw.includes(documentedDivergence), 'expected reference file to still contain the documented divergence line -- has v1-resume.tex changed?');
  let referenceAdjusted = referenceRaw.replace(documentedDivergence, '');

  // The Additional Information rows in the reference resume separate values with
  // " $|$ " while the Technical Skills rows use ", ". That is why
  // technical_skill_row carries a per-row `separator` (D-013) -- the fixtures below
  // set it accordingly, and the render must match the reference byte for byte.

  const normalizedActual = normalizeInsignificantWhitespace(tex);
  const normalizedExpected = normalizeInsignificantWhitespace(referenceAdjusted);

  if (normalizedActual !== normalizedExpected) {
    const actualPath = join(scratchDir, 'normalized-actual.tex');
    const expectedPath = join(scratchDir, 'normalized-expected.tex');
    writeFileSync(actualPath, normalizedActual);
    writeFileSync(expectedPath, normalizedExpected);
    let diffOutput = '';
    try {
      execFileSync('diff', ['-u', expectedPath, actualPath], { encoding: 'utf8' });
    } catch (err) {
      diffOutput = (err as { stdout?: string }).stdout ?? String(err);
    }
    console.log('--- ROUND TRIP DIFF (expected vs actual, normalized) ---');
    console.log(diffOutput);
  }

  assert.equal(normalizedActual, normalizedExpected);
});

// ---------------------------------------------------------------------------
// Conditional sections (<<IF:TOKEN>> ... <<ENDIF>>).
//
// Regression guard for a fatal bug: when a section's token expanded to nothing,
// the template's surrounding \begin{itemize} was left with no \item, which
// aborts pdflatex with "Something's wrong--perhaps a missing \item". Turning a
// whole section off is normal while tailoring a resume, so it must render.
// ---------------------------------------------------------------------------

test('a section with content keeps its <<IF>> block body', () => {
  const library = emptyLibrary();
  library.skillRows = [
    { id: 'r', name: 'Languages', top: true, separator: ', ', isArchived: false, skills: [{ id: 's', name: 'Rust', isArchived: false }] },
  ];
  const selections = emptySelections();
  selections.skillRows = ['r'];
  selections.skills = { r: ['s'] };

  const { tex } = renderResume({
    templateContent: '<<IF:SKILLS_TOP>>\\section{Skills}<<SKILLS_TOP>><<ENDIF>>',
    library,
    selections,
  });
  assert.match(tex, /\\section\{Skills\}/);
  assert.match(tex, /Rust/);
  assert.doesNotMatch(tex, /<<IF:|<<ENDIF>>/);
});

test('an empty section drops the whole <<IF>> block, heading included', () => {
  const { tex } = renderResume({
    templateContent: 'BEFORE<<IF:PROJECTS>>\\section{Projects}\\begin{itemize}<<PROJECTS>>\\end{itemize}<<ENDIF>>AFTER',
    library: emptyLibrary(),
    selections: emptySelections(),
  });
  assert.equal(tex, 'BEFOREAFTER');
  // The itemize must not survive without an \item — that is the fatal case.
  assert.doesNotMatch(tex, /begin\{itemize\}/);
});

test('each of the four sections can be emptied independently', () => {
  const template = [
    '<<IF:EXPERIENCES>>E:<<EXPERIENCES>><<ENDIF>>',
    '<<IF:PROJECTS>>P:<<PROJECTS>><<ENDIF>>',
    '<<IF:SKILLS_TOP>>T:<<SKILLS_TOP>><<ENDIF>>',
    '<<IF:SKILLS_BOTTOM>>B:<<SKILLS_BOTTOM>><<ENDIF>>',
  ].join('\n');
  const { tex } = renderResume({
    templateContent: template,
    library: emptyLibrary(),
    selections: emptySelections(),
  });
  assert.equal(tex.trim(), '');
});

test('the default template survives every section being deselected', () => {
  const { tex, warnings } = renderResume({
    templateContent: DEFAULT_TEMPLATE,
    library: emptyLibrary(),
    selections: emptySelections(),
  });
  // Every section is gone — heading, list wrapper and all — so no \begin{itemize}
  // is left without an \item. (The \newcommand definitions in the preamble
  // legitimately contain a bare \begin{itemize}; only *usages* matter, and the
  // real proof is the compile check in scripts/smoke.ts.)
  for (const heading of ['\\section{Technical Skills}', '\\section{Experience}', '\\section{Projects}', '\\section{Additional Information}']) {
    assert.doesNotMatch(tex, new RegExp(heading.replace(/[\\{}]/g, '\\$&')), `${heading} should be dropped`);
  }
  assert.match(tex, /\\begin\{document\}/);
  assert.match(tex, /\\end\{document\}/);
  assert.deepEqual(warnings, []);
});

test('an unmatched <<ENDIF>> is reported rather than silently mis-rendering', () => {
  const { warnings } = renderResume({
    templateContent: 'x<<ENDIF>>',
    library: emptyLibrary(),
    selections: emptySelections(),
  });
  assert.ok(warnings.some((w) => w.includes('unmatched')), warnings.join('; '));
});
