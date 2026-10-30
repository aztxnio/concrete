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
2. Click **Publish**. It sits just above the toolbar and shows how many
   changes haven't been published yet.
3. The first time, it asks for the GitHub project and a key (see below). On the
   site's github.io address the project is already filled in, so just paste the
   key. It's saved in your browser, so you only do this once.

Everyone sees the changes within a few minutes. Changes stay in the browser
they were made in until they're published, so do your editing in one browser.

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
