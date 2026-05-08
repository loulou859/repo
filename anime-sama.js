// ============================================================
// Provider Nuvio : Anime-Sama
// Domaine       : https://anime-sama.to
// Compatible    : Hermes / React Native
// Style          : Promise chains ONLY
// ============================================================

const DOMAIN = "https://anime-sama.to";

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/:/g, "")
    .replace(/'/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function fetchHTML(url) {
  return fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": DOMAIN + "/"
    }
  }).then(function (r) {
    return r.text();
  });
}

function extractEpisodes(html) {
  const match = html.match(/var\s+episodes\s*=\s*(\[[\s\S]*?\]);/);

  if (!match) {
    return [];
  }

  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return [];
  }
}

function extractIframes(html) {
  const regex = /<iframe[^>]+src=["']([^"']+)["']/g;

  const results = [];
  let match;

  while ((match = regex.exec(html)) !== null) {
    results.push(match[1]);
  }

  return results;
}

function buildAnimeURL(title, season, lang) {
  const slug = slugify(title);

  let url = DOMAIN + "/catalogue/" + slug + "/";

  if (season) {
    url += "saison" + season + "/";
  }

  url += lang || "vostfr";

  return url;
}

function getEpisodePage(title, season, episode, lang) {
  const animeURL = buildAnimeURL(title, season, lang);

  return fetchHTML(animeURL).then(function (html) {
    const episodes = extractEpisodes(html);

    if (!episodes || !episodes.length) {
      throw new Error("Episodes introuvables");
    }

    const epUrl = episodes[episode - 1];

    if (!epUrl) {
      throw new Error("Episode introuvable");
    }

    return fetchHTML(epUrl);
  });
}

function getStreams(info) {
  return getEpisodePage(
    info.title,
    info.season,
    info.episode,
    info.lang
  )
    .then(function (html) {
      const iframes = extractIframes(html);

      return iframes.map(function (url) {
        return {
          server: "Anime-Sama",
          type: "hls",
          url: url,
          headers: {
            Referer: DOMAIN + "/",
            Origin: DOMAIN
          }
        };
      });
    })
    .catch(function (err) {
      console.log("Anime-Sama provider error:", err);

      return [];
    });
}

module.exports = {
  getStreams
};
