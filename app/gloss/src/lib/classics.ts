import type { TopicKey } from "./library";

/**
 * A first shelf for an empty library: essays people keep coming back to, each
 * checked to read in cleanly through the importer, with a painted cover that
 * ships with the app. Shelved by hand, so they need no sorting.
 */
export type Classic = { key: string; url: string; title: string; author: string; year: number; topic: TopicKey };

export const CLASSICS: Classic[] = [
  { key: "hamming-research", url: "https://www.cs.virginia.edu/~robins/YouAndYourResearch.html", title: "You and Your Research", author: "Richard Hamming", year: 1986, topic: "work" },
  { key: "feynman-cargo", url: "https://calteches.library.caltech.edu/51/2/CargoCult.htm", title: "Cargo Cult Science", author: "Richard Feynman", year: 1974, topic: "science" },
  { key: "orwell-politics", url: "https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/politics-and-the-english-language/", title: "Politics and the English Language", author: "George Orwell", year: 1946, topic: "writing" },
  { key: "sutton-bitter", url: "http://www.incompleteideas.net/IncIdeas/BitterLesson.html", title: "The Bitter Lesson", author: "Rich Sutton", year: 2019, topic: "ai" },
  { key: "karpathy-sw2", url: "https://karpathy.medium.com/software-2-0-a64152b37c35", title: "Software 2.0", author: "Andrej Karpathy", year: 2017, topic: "ai" },
  { key: "gabriel-worse", url: "https://www.dreamsongs.com/RiseOfWorseIsBetter.html", title: "The Rise of Worse Is Better", author: "Richard P. Gabriel", year: 1989, topic: "programming" },
  { key: "licklider", url: "https://groups.csail.mit.edu/medg/people/psz/Licklider.html", title: "Man-Computer Symbiosis", author: "J. C. R. Licklider", year: 1960, topic: "learning" },
  { key: "pg-dont-scale", url: "https://paulgraham.com/ds.html", title: "Do Things That Don't Scale", author: "Paul Graham", year: 2013, topic: "startups" },
  { key: "kelly-fans", url: "https://kk.org/thetechnium/1000-true-fans/", title: "1,000 True Fans", author: "Kevin Kelly", year: 2008, topic: "business" },
  { key: "pg-great-work", url: "https://paulgraham.com/greatwork.html", title: "How to Do Great Work", author: "Paul Graham", year: 2023, topic: "work" },
  { key: "dfw-water", url: "https://fs.blog/david-foster-wallace-this-is-water/", title: "This Is Water", author: "David Foster Wallace", year: 2005, topic: "living" },
  { key: "urban-tail", url: "https://waitbutwhy.com/2015/12/the-tail-end.html", title: "The Tail End", author: "Tim Urban", year: 2015, topic: "living" },
];

export const classicCover = (c: Classic) => `${import.meta.env.BASE_URL}library/covers/${c.key}.webp`;

/** The bundled samples, shelved: where each goes, and its cover. */
export const SAMPLE_SHELF: Record<string, { topic: TopicKey; cover: string }> = {
  "on-a-piece-of-chalk": { topic: "science", cover: `${import.meta.env.BASE_URL}library/covers/on-a-piece-of-chalk.webp` },
  "on-thinking-for-oneself": { topic: "philosophy", cover: `${import.meta.env.BASE_URL}library/covers/on-thinking-for-oneself.webp` },
  "walden-reading": { topic: "learning", cover: `${import.meta.env.BASE_URL}library/covers/walden-reading.webp` },
};
