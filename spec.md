# Optimizing My Resume Workflow

I want you to help me build out an application that will help me optimize my resume workflow to better build custom resumes for every company I apply to. Many of the features this application will support are inspired my my first version of this application in ../Resume/, but I want to restart because as I built that one my requirements changed and I want to build something from the ground up that has what I am looking for. Feel free to reference that in terms of what features existed, but don't copy too much of the code as there is a reason we are starting from scratch.

## Problem Statement

The main problem I am trying to solve with this application is that I want to customize my resume for every job I apply to, but I don't want to sacrafice on quality or time for this customization. I have a number of experiences, projects, and other things that could go on my resume, and so the challenge then becomes figuring out what exactly belongs there.

The core feature behind this application is the idea that if I can just define every project / experience / bullet that _might_ go on my resume, the act of customizing just becomes a matter of picking which bullets / projects / experiences are the best for _that specific job_. This is kind of difficult just working with a normal resume in Latex (my editor of choice), and so if I have a UI to help me do this picking visually I can make custom resumes both quickly and without sacraficing on quantity.

## Features

In addition to selecting things to either show up or not show up on my resume, I also want this application to serve as my primary hub for editing and maintaining my Resume. It should allow me to change effectively anything about it via editting the latex, and it should be able to support the fact that I will be working with many different variations of the same resume as I apply to many different jobs. For this reason, it will be important to keep in mind what changes apply to which resumes.

In order to make this distinction clear, I want to define the following terms:

- A "template" is the Latex that defines the format and style of the resume. It what the content is ultimately fitted into in order to produce a final PDF, but it is independent of the content itself, and we could in theory have multiple templates working with the same content (although thats not a priority right now)
- "Content" is the actual strings that could be filled into the template to make the resume. This could be an experience, a bullet for an experience, skills, etc.
- A "Resume" then represents the combination of the template and the content, but with specific pieces of content in a specific order.

This means that multiple resumes can reference the same piece of content, and if that content were to change so should the output of both Resumes. This is an intentional design decision.

From there, there are a couple different things I want to be able to do as a user of this application:

- When I first land, I want to see all of my resumes in a grid pattern. Each of them should have the company name and the date it was created in clikcable box (no need to render the pdf for this that would be basically useless). I should also be able to fuzzy search over these resumes. In the top left should be a blank one that I can click to create a new resume. Imediately to the right of the blank one should be my "Default" Resume which represents my default resume, and also serves as a starting point whenever I make a new Resume
- When I click to create a new resume, it should prompt me for the name of the company, and then take me to a page very similar to the first iteration of this resume application. Here, I should see the content on the left, and the live pdf of the rendered Latex on the right. Changing the order or selecting / deselecting content should be saved only to the currently opened resume, but editting content (creating, updating, or archiving), should be a global change that effects all resumes. Saves should happen automatically
- I'd also like to be able to edit the template from this screen. At the top of the screen there should be two tabs, a content tab (default) and a template tab. The template should allow me to change the actual latex directly and see the result on the preview, and similar to editting content should be global to all resumes.
- Finally, I should be able to download a pdf, which should save the resume in the format "Chris*Pyle*<company name>\_Resume.pdf", with the company name automatically snaked cased and first letter of each word capitalized, regardless of what I wrote as the title. In addition, this should save the pdf to that resume, and on the home page each resume should have a download button for the most recent pdf. This also somewhat serves to mitigate drift from changing templates or content. If I save a resume, and then change the template or content, but click the download button from the home screen, it should give me the version that it was saved with. Whereas if I open the resume again, and click the save button in the top right, it should resave with the new content and template.
- I'm sure there are other small features I am forgetting, but those are the main ideas.

## Database Schema

As I am sure you can imagine, the degree of abstraction used in this project will greatly effect the complexity and the functionality. I want to give you the rough db schema I am looking for up front, that way this should be pretty clear. I do want all of this to be in an sql database, which you should run as a separate postgres container alongside the app. The following are the rough tables and fields I am looking for, but I am sure I will miss things so think of this more as a rough view of what I am looking for:

- Template
  - template content (string storing the latex)
  - isarchived
  - isdefault
  - name

- Resume
  - name
  - isdefault
  - template (fkey)

- Resume Experience
  - resume (fkey)
  - experience (fkey)
  - order (int)

- Resume Experience Bullet
  - resume (fkey)
  - experience bullet (fkey)
  - order (int)

- Resume Project
  - resume (fkey)
  - Project (fkey)
  - order (int)

- Resume Project Bullet
  - resume (fkey)
  - project bullet (fkey)
  - order (int)

- Resume Technical Skill Row
  - resume (fkey)
  - technical skill row(fkey)
  - order (int)

- Resume Technical Skill
  - resume (fkey)
  - technical skill (fkey)
  - order (int)

- Experience
  - company
  - title
  - date range (string)
  - location
  - isarchived

- Experience Bullet
  - experience (fkey)
  - content
  - isarchived

- Project
  - name
  - technologies
  - date range (string)
  - isarchived

- Project Bullet
  - Project (fkey)
  - content
  - isarchived

- Technical Skill Row
  - name
  - isarchived
  - top (boolean)

- Technical Skill
  - name
  - isarchived

## Technical implementation details

It should be pretty clear what I am going for based on the schema, and given the rough schema and spec I want to leave a lot of details up to you, but there are some implementation details worth pointing out

- I would like the template string to contain escape characters that are then used as references to different parts of the resume such as the experiences or projects or whatever. For the technical skill rows, I included the top boolean because as you see in my current resume I have the "technical skills" section on top, and the "additional information" section at the very bottom. The technical skills tables should be able to represent both of these.
- The bridge tables also contain the ordering for the content on the resume. Make sure these bridge tables use a composite pkey of their two fkeys, so that sql can enforce some of the structure
- we onyl every archive, that way resumes can reference archived things and it is fine. there should be a way to toggle to see archived content, but by default it should be hidden
- I intentionally did not include content that is currently editable in the V1 such as the education section. This is because changes to the education section should just be done by editing the template directly
- we will need to figure out some sort of file storage solution at some point.

One important smoke test to keep in mind when you are making design decisions for this project is that I should always be able to represent my current resume within the project, which you can find in the v1

## Tech stack

- I do not care about the tech stack that much, but I would like to use a sql backend because I eventually want to host this supabase + vercel. I think the supabase backend as an api should be good enough for the vercel frontend, so I would lean towards that approach from the start if possible. While we may eventually go multi-user, I want to start with just me, so we can have the site be gated a password that gets saved in the users browser storage whenever they enter it (that way I can make the password long and difficult to guess but not have to enter it every time).
