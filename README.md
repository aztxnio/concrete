# Concrete mixes

A page for browsing types of concrete and the ingredients that go into each one.
It's plain HTML, CSS and JavaScript with nothing to install. Open `index.html`
in a browser to try it, or put the folder on any web host.

## Adding and editing concretes and ingredients

Everything visitors see comes from `data.js`, and nobody has to edit it by
hand. To change it:

1. Open the site. Use **Add concrete** and **Add ingredient** for new ones. To
   change one, click it in the list, then **Edit**. The edit form also has
   **Delete**, and Undo brings back anything deleted by mistake. Changes are
   saved in your browser as you go.

   Each one also has its own page, opened with **See more**. The **Notes** box
   in its form is the longer write-up shown there.

   Tick **Still a work in progress** in its form while it isn't finished. Its
   name then shows in italics until that's unticked.

   A concrete's ingredients are ticked in the list on the right while its form
   is open: click one once if it goes in, again to make it a maybe, and a third
   time to take it out. The box beside a ticked one takes how many parts of it
   the concrete needs. A concrete's form also has **Synonyms** (other names it
   goes by, which search finds), **Recipe**, **Chemical composition** and
   **Reactions**. Ingredients have **Chemical composition** too.
2. Click **Publish**. It sits just above the toolbar and shows how many
   changes haven't been published yet.
3. The first time, it asks for the GitHub project and a key (see below). On the
   site's github.io address the project is already filled in, so just paste the
   key. It's saved in your browser, so you only do this once.

Everyone sees the changes within a few minutes. Changes stay in the browser
they were made in until they're published, so do your editing in one browser.

## Finding things

Each list has a search box that looks through names, descriptions, notes and
tags, and for concretes, the names of their ingredients too.

To tag something, use **Tags** in its form. Every tag already in use is there
to click on or off, and a new one goes in the **New tag** box (press Enter to
add it). A button for each tag also appears above the list. Click one to see
only what has that tag, or several to narrow it further. **Work in progress**
there shows only what's unfinished, and **Clear** shows everything again.

## Arranging the lists

- Both lists can have groups. Type a group's name into **Group** in the form,
  and everything with that name is listed together under it.
- Drag a row up or down to move it, including into another group. Drag a
  group's heading to move the whole group.
- Double-click a group's name to rename it for everything in it. Renaming it
  to another group's name puts the two together.
- From the keyboard, Alt with the up or down arrow moves the selected row or
  group, and Enter on a group's name renames it.

The order is published along with everything else.

## The table

**Table**, at the top left of the paper, swaps the paper for a table of every
concrete (down the side) against every ingredient (across the top). A filled
square means the ingredient goes in, an outlined one means maybe, and a number
is how many parts. It shows what the lists show, so their searches and tags
narrow it too. **Paper** goes back.

## The paper

- It opens in the middle, on whatever's been put there.
- Drag things onto it from the lists, or use their **+** button.
- Click a bubble to select it, and click empty paper to clear the selection.
- Drag empty paper to move around.
- Zoom with **−** and **+** in the bottom right corner, by pinching, or by holding
  Ctrl (⌘ on a Mac) and scrolling. The percentage takes it back to 100%.
- The half-filled circle beside them switches between dark and light paper.
  Until it's used, the paper follows the computer's own setting.
- The arrow by each list's title hides the list, to give the paper more room.
  Click the strip it leaves to bring it back.

## Making the key

The key lets the site update this one GitHub project, and nothing else. Whoever
owns the project makes it:

1. While signed in to GitHub, go to
   github.com/settings/personal-access-tokens/new.
2. Give it a name, like "Concrete site", and choose when it expires.
3. Under **Repository access**, choose **Only select repositories** and pick
   the site's project.
4. Under permissions, set **Contents** to **Read and write**.
5. Click **Generate token**, copy the key (it starts with `github_pat_`), and
   send it to whoever's adding the data.

Treat the key like a password. When it expires, Publish asks for a new one, so
make another the same way.

Publishing without a key works too: the Publish form has **Download data.js
instead**. Upload that file to the project in place of the old one (**Add file
→ Upload files**, then **Commit changes**). Check it's called exactly `data.js`
first, since browsers sometimes save it as `data (1).js`.

## Putting it online

GitHub Pages hosts it for free:

1. Make a new project on GitHub and upload every file in this folder.
2. In the project's **Settings**, open **Pages**, choose to deploy from the
   `main` branch, and save.
3. After a minute or two the Pages screen shows the site's address.
