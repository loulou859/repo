// =============================================================
// Provider Nuvio : Afterdark (VF / VOSTFR / MULTI)
// Version : 1.1.0
// - Header: Afterdark - [Serveur] [Qualité]
// - Format : Supporte NDJSON (flux JSON ligne par ligne)
// - Domaines : Récupérés dynamiquement depuis GitHub (clé: "aftdrk")
// =============================================================

var TMDB_KEY       = 'f3d757824f08ea2cff45eb8f47ca3a1e';
var AFTERDARK_UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var GITHUB_JSON_URL = 'https://raw.githubusercontent.com/iokza/NoAds4Website/main/domains.json';
var DEFAULT_DOMAIN = 'afterdark06.mom'; // Fallback si GitHub est down
var API_PATH       = '/api/staging-20260420-yuna-hipaa-86nnorn0/sources';

// ─── Fetch Configuration Domaine ─────────────────────────────

function fetchBaseUrl() {
  return fetch(GITHUB_JSON_URL)
    .then(function(res) { 
      if (!res.ok) throw new Error();
      return res.json(); 
    })
    .then(function(config) {
      if (config && config.aftdrk) {
        return 'https://' + config.aftdrk;
      }
      return 'https://' + DEFAULT_DOMAIN;
    })
    .catch(function() {
      return 'https://' + DEFAULT_DOMAIN;
    });
}

// ─── TMDB Helpers ───────────────────────────────────────────

function getTmdbMetadata(tmdbId, type) {
  var url = 'https://api.themoviedb.org/3/' + (type === 'tv' ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=fr-FR';
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      return {
        title: data.title || data.name || "Afterdark",
        originalTitle: data.original_title || data.original_name || "",
        releaseYear: (data.release_date || data.first_air_date || "").split('-')[0] || "",
        imdbId: data.imdb_id || ""
      };
    })
    .catch(function() { 
      return { title: "Afterdark", originalTitle: "", releaseYear: "", imdbId: "" }; 
    });
}

function getExternalImdbId(tmdbId, type) {
  if (type !== 'tv') return Promise.resolve("");
  var url = 'https://api.themoviedb.org/3/tv/' + tmdbId + '/external_ids?api_key=' + TMDB_KEY;
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) { return data.imdb_id || ""; })
    .catch(function() { return ""; });
}

// ─── UI / Formatting ─────────────────────────────────────────

function parseLangInfo(lang) {
  var text = String(lang || 'vf').toUpperCase();
  if (text.indexOf('MULTI') !== -1) return { icon: '🌍', label: 'MULTI' };
  if (text.indexOf('VOST') !== -1) return { icon: '🔡', label: 'VOSTFR' };
  if (text.indexOf('VO') !== -1 || text.indexOf('ENG') !== -1) return { icon: '🇬🇧', label: 'VO' };
  return { icon: '🇫🇷', label: 'VF' };
}

function parseQuality(q) {
  if (!q || q === 'unknown') return 'HD';
  var s = String(q).toUpperCase();
  if (s.indexOf('4K') !== -1 || s.indexOf('2160') !== -1) return '4K';
  if (s.indexOf('1080') !== -1) return '1080p';
  if (s.indexOf('720') !== -1) return '720p';
  return s;
}

function normalizeSources(rawLines, meta, baseUrl, season, episode) {
  var results = [];

  for (var i = 0; i < rawLines.length; i++) {
    var lineText = rawLines[i].trim();
    if (!lineText) continue;

    try {
      var chunk = JSON.parse(lineText);
      if (!chunk.items || !chunk.items.length) continue;

      var serverId = chunk.id || "Serveur";
      var serverName = serverId.charAt(0).toUpperCase() + serverId.slice(1);

      for (var j = 0; j < chunk.items.length; j++) {
        var item = chunk.items[j];
        if (!item || !item.url) continue;

        var quality = parseQuality(item.quality);
        var langInfo = parseLangInfo(item.language);
        var service = (item.service || "Direct").toUpperCase();
        var isProxied = item.proxied ? '🔒 Proxied' : '🌐 Direct';

        var titleLine = '🎬 ';
        if (season && episode) {
          titleLine += 'S' + season + ' E' + episode + ' | ' + meta.title;
        } else {
          titleLine += meta.title + (meta.releaseYear ? ' (' + meta.releaseYear + ')' : '');
        }

        var specs = [
          '📺 ' + quality,
          langInfo.icon + ' ' + langInfo.label,
          '🛠️ ' + service,
          isProxied
        ];

        results.push({
          name: 'Afterdark - ' + serverName + ' (' + quality + ')',
          title: titleLine + '\n' + specs.join(' | '),
          url: item.url,
          quality: quality,
          format: (item.type && item.type !== 'unknown') ? item.type : 'embed',
          headers: {
            'User-Agent': AFTERDARK_UA,
            'Referer': baseUrl + '/'
          }
        });
      }
    } catch (e) {
      // Ignore les lignes incomplètes du NDJSON
    }
  }
  return results;
}

// ─── Entry Point ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[Afterdark] START tmdbId=' + tmdbId + ' type=' + mediaType);

  return Promise.all([
    getTmdbMetadata(tmdbId, mediaType),
    getExternalImdbId(tmdbId, mediaType),
    fetchBaseUrl() // Récupère l'URL courante via GitHub
  ]).then(function(results) {
    var meta = results[0];
    var tvImdbId = results[1];
    var baseUrl = results[2];
    
    var imdbId = meta.imdbId || tvImdbId || "";

    var queryParams = [
      'tmdbId=' + tmdbId,
      'type=' + mediaType,
      'imdbId=' + imdbId,
      'title=' + encodeURIComponent(meta.title),
      'releaseYear=' + meta.releaseYear,
      'originalTitle=' + encodeURIComponent(meta.originalTitle)
    ];

    if (mediaType === 'tv') {
      queryParams.push('season=' + season);
      queryParams.push('episode=' + episode);
    }

    var requestUrl = baseUrl + API_PATH + '?' + queryParams.join('&');

    return fetch(requestUrl, {
      headers: { 
        'User-Agent': AFTERDARK_UA,
        'Referer': baseUrl + '/'
      }
    })
    .then(function(res) {
      if (!res.ok) throw new Error('API HTTP ' + res.status);
      return res.text();
    })
    .then(function(textBody) {
      var lines = textBody.split('\n');
      return normalizeSources(lines, meta, baseUrl, season, episode);
    });
  }).catch(function(err) {
    console.error('[Afterdark] Erreur globale :', err.message || err);
    return [];
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
