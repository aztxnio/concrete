// The concretes and ingredients everyone sees when they open the site.
//
// To change them, use Add and Edit on the page, then click Publish. Until
// then, changes are only saved in the browser they were made in.
//
// This file can be edited by hand too, though publishing rewrites it and
// drops any comments other than this one. Each concrete lists its
// ingredients by id, so every id in a concrete's `ingredients` has to match
// an ingredient below. The page warns in the browser console if one doesn't.
//
// `icon` is optional: a path to an image (for example "icons/sand.png") or an
// image data URL. Without one, the item shows a plain circle.
// `group` is optional too. Ingredients that share a group are listed together
// under that heading.
// `notes` is optional as well: the longer write-up on the item's own page,
// which opens from See more.

const SEED = {
  concretes: [
    {
      id: "concrete",
      name: "Concrete",
      description: "This is a description.",
      icon: "",
      ingredients: ["ingredient"],
    },
  ],

  ingredients: [
    {
      id: "ingredient",
      name: "Ingredient",
      description: "This is a description.",
      icon: "",
      group: "",
    },
  ],
};
