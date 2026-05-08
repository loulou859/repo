// anime-sama.js — Provider Nuvio pour anime-sama.to
// Supporte : recherche par titre, saisons, épisodes, VF/VOSTFR
// Lecteurs : Vidmoly (m3u8), Sibnet, Smoothpre, fallback direct

const BASE_URL = "https://anime-sama.to";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Connection": "keep-alive",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchHtml(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: { ...HEADERS, ...extraHeaders } });
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  return res.text();
}

function extractSeasons(html) {
  // Cherche panneauAnime("Saison 1", "saison1/vostfr")
  const pattern = /panneauAnime\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
  const seasons = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const name = match[1];
    const path = match[2];
    // Exclure les films si besoin (optionnel)
    seasons.push({ name, path });
  }
  return seasons;
}

async function getFilever(seasonUrl) {
  const html = await fetchHtml(seasonUrl, { Referer: BASE_URL + "/" });
  const m = html.match(/episodes\.js\?filever=(\d+)/);
  return m ? m[1] : null;
}

async function getEpisodeUrls(seasonUrl, filever) {
  const url = `${seasonUrl.replace(/\/$/, "")}/episodes.js?filever=${filever}`;
  const js = await fetchHtml(url, { Referer: seasonUrl });

  // Récupère tous les arrays eps1, eps2, etc.
  const arrayPattern = /var\s+eps\d+\s*=\s*\[([\s\S]*?)\];/g;
  const allArrays = [];
  let m;
  while ((m = arrayPattern.exec(js)) !== null) {
    const links = [...m[1].matchAll(/https?:\/\/[^\s'",]+/g)].map(x => x[0]);
    if (links.length) allArrays.push(links);
  }

  if (!allArrays.length) return {};

  // Préférer Sibnet ou Smoothpre (plus fiables que Vidmoly)
  let chosen = allArrays[0];
  for (const arr of allArrays) {
    const sample = arr[0].toLowerCase();
    if (sample.includes("sibnet") || sample.includes("smoothpre") || sample.includes("sendvid")) {
      chosen = arr;
      break;
    }
  }

  // Retourne { "1": url, "2": url, ... }
  const result = {};
  chosen.forEach((link, i) => { result[String(i + 1)] = link; });
  return result;
}

// ─── Extraction d'URL de stream selon le lecteur ──────────────────────────────

async function resolveStreamUrl(providerUrl) {
  if (!providerUrl) return null;

  try {
    // Vidmoly → chercher un .m3u8 dans la page
    if (providerUrl.includes("vidmoly")) {
      const html = await fetchHtml(providerUrl, { Referer: BASE_URL + "/" });
      const m = html.match(/file:\s*['"](\https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/);
      return m ? m[1] : providerUrl;
    }

    // Sibnet → récupérer le hash vidéo et construire l'URL directe
    if (providerUrl.includes("sibnet.ru")) {
      const m = providerUrl.match(/videoid=(\d+)/);
      if (!m) return providerUrl;
      const videoId = m[1];
      const html = await fetchHtml(`https://video.sibnet.ru/shell.php?videoid=${videoId}`, {
        Referer: "https://video.sibnet.ru/",
      });
      const hashMatch = html.match(/player\.src\(\[\{src:\s*"\/v\/([^/]+)\//);
      if (!hashMatch) return providerUrl;
      const videoHash = hashMatch[1];
      // Sibnet redirige → on retourne l'URL et on laisse le player gérer
      return `https://video.sibnet.ru/v/${videoHash}/${videoId}.mp4`;
    }

    // Smoothpre → dépacker le JS obfusqué (Dean Edwards packer)
    if (providerUrl.toLowerCase().includes("smoothpre")) {
      const html = await fetchHtml(providerUrl, { Referer: BASE_URL + "/" });
      const packedMatch = html.match(/eval\((function\(p,a,c,k,e,d\)[\s\S]+?)\)\s*</);
      if (packedMatch) {
        // Extraction simple : chercher directement un .m3u8 dans le JS packé
        // (approche légère sans dépacker complètement)
        const m3u8 = html.match(/['"]([^'"]+\.m3u8[^'"]*)['"]/);
        if (m3u8) return m3u8[1];
      }
      return providerUrl;
    }

    return providerUrl;
  } catch (e) {
    console.error(`[AnimeSama] Erreur résolution lecteur : ${e.message}`);
    return providerUrl;
  }
}

// ─── Recherche d'anime par titre ──────────────────────────────────────────────

async function searchAnime(query, vf = false) {
  const params = new URLSearchParams({ search: query, "type[]": "Anime" });
  if (vf) params.append("langue[]", "VF");

  const html = await fetchHtml(`${BASE_URL}/catalogue/?${params}`, {
    Referer: `${BASE_URL}/catalogue/`,
  });

  const results = [];
  const linkPattern = /<a[^>]+href="(https:\/\/anime-sama\.to\/catalogue\/[^"]+)"[^>]*>[\s\S]*?<h[12][^>]*class="[^"]*card-title[^"]*"[^>]*>([^<]+)<\/h[12]>/g;
  let m;
  while ((m = linkPattern.exec(html)) !== null) {
    results.push({ url: m[1], title: m[2].trim() });
  }
  return results;
}

// ─── Fonction principale exportée ─────────────────────────────────────────────

async function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[AnimeSama] Recherche tmdbId=${tmdbId} type=${mediaType} s=${season} ep=${episode}`);

  // Nuvio passe le titre via tmdbId sous forme de string si non résolu,
  // ou on peut faire une recherche par tmdbId → titre via TMDB API publique
  // Ici on tente une recherche titre depuis tmdbId en fetchant l'API TMDB non-auth
  let title = "";
  try {
    const tmdbRes = await fetch(`https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=1b7c7148c2a37a18e0069adfdb4aab66&language=fr-FR`);
    const tmdbData = await tmdbRes.json();
    title = tmdbData.name || tmdbData.title || "";
  } catch (e) {
    console.error(`[AnimeSama] TMDB lookup échoué : ${e.message}`);
    return [];
  }

  if (!title) return [];
  console.log(`[AnimeSama] Titre TMDB : ${title}`);

  // Recherche sur anime-sama
  const animeResults = await searchAnime(title);
  if (!animeResults.length) {
    console.log(`[AnimeSama] Aucun résultat pour "${title}"`);
    return [];
  }

  const animeUrl = animeResults[0].url;
  console.log(`[AnimeSama] Anime trouvé : ${animeUrl}`);

  // Récupérer les saisons
  const animeHtml = await fetchHtml(animeUrl, { Referer: BASE_URL + "/" });
  const seasons = extractSeasons(animeHtml);
  if (!seasons.length) return [];

  // Trouver la bonne saison (VF ou VOSTFR, numéro de saison)
  // On cherche "saison{N}" dans le path, en préférant VF si dispo
  const targetSeason = season || 1;
  let matchedSeason = null;

  // Priorité VF
  for (const s of seasons) {
    const pathLower = s.path.toLowerCase();
    if (pathLower.includes(`saison${targetSeason}`) && pathLower.includes("vf")) {
      matchedSeason = s;
      break;
    }
  }
  // Fallback VOSTFR
  if (!matchedSeason) {
    for (const s of seasons) {
      const pathLower = s.path.toLowerCase();
      if (pathLower.includes(`saison${targetSeason}`)) {
        matchedSeason = s;
        break;
      }
    }
  }
  // Fallback première saison trouvée
  if (!matchedSeason) matchedSeason = seasons[0];

  const seasonUrl = `${animeUrl.replace(/\/$/, "")}/${matchedSeason.path.replace(/^\//, "")}`;
  console.log(`[AnimeSama] Saison URL : ${seasonUrl}`);

  // Récupérer filever
  const filever = await getFilever(seasonUrl);
  if (!filever) return [];

  // Récupérer les épisodes
  const episodesMap = await getEpisodeUrls(seasonUrl, filever);
  const epKey = String(episode || 1);
  const providerUrl = episodesMap[epKey];

  if (!providerUrl) {
    console.log(`[AnimeSama] Épisode ${epKey} introuvable`);
    return [];
  }

  console.log(`[AnimeSama] Provider URL : ${providerUrl}`);

  // Résoudre l'URL de stream
  const streamUrl = await resolveStreamUrl(providerUrl);
  if (!streamUrl) return [];

  // Détecter la qualité
  const isVf = matchedSeason.path.toLowerCase().includes("vf");
  const langLabel = isVf ? "VF" : "VOSTFR";

  return [{
    name: "AnimeSama",
    title: `${animeResults[0].title} - ${matchedSeason.name} - Ep.${epKey} [${langLabel}]`,
    url: streamUrl,
    quality: "1080p",
    headers: {
      "Referer": providerUrl,
      "User-Agent": HEADERS["User-Agent"],
    },
  }];
}

module.exports = { getStreams };
