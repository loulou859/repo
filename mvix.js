// =============================================================
// Provider Nuvio : Movix (VF/VOSTFR français)
// Version : 4.5.0
// - Domaine récupéré automatiquement depuis domains.json (GitHub)
// - Fallback sur movix.cash si la lecture échoue
//   Triple API (purstream + cpasmal + fstream)
//   + Darkino (Nightflix/darkibox) en bonus
// =============================================================

var TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';
var DOMAINS_URL = 'https://raw.githubusercontent.com/iokza/NoAds4Website/refs/heads/main/domains.json';
var MOVIX_FALLBACK = 'cash';
var MOVIX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

var _cachedEndpoint = null;

// ─── Récupération du domaine depuis GitHub ───────────────────

function detectApi() {
  if (_cachedEndpoint) return Promise.resolve(_cachedEndpoint);

  return fetch(DOMAINS_URL)
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      var tld = data['mvx'];
      if (!tld) throw new Error('Clé "mvx" absente du domains.json');
      console.log('[Movix] Domaine récupéré: movix.' + tld);
      _cachedEndpoint = {
        api:     'https://api.movix.' + tld,
        referer: 'https://movix.' + tld + '/'
      };
      return _cachedEndpoint;
    })
    .catch(function(err) {
      console.warn('[Movix] Lecture domains.json échouée (' + (err.message || err) + '), fallback: movix.' + MOVIX_FALLBACK);
      _cachedEndpoint = {
        api:     'https://api.movix.' + MOVIX_FALLBACK,
        referer: 'https://movix.' + MOVIX_FALLBACK + '/'
      };
      return _cachedEndpoint;
    });
}

// ─── TMDB Helpers ────────────────────────────────────────────

function getTmdbMetadata(tmdbId, type) {
  var url = 'https://api.themoviedb.org/3/' + (type === 'tv' ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=fr-FR';
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      return {
        name: data.title || data.name || 'Movix',
        year: (data.release_date || data.first_air_date || '').split('-')[0],
        duration: data.runtime ? data.runtime + ' min' : ''
      };
    })
    .catch(function() { 
      return { name: 'Movix', year: '', duration: '' }; 
    });
}

function getEpisodeInfo(tmdbId, season, episode) {
  if (!tmdbId || !season || !episode) return Promise.resolve(null);
  var url = 'https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + season + '/episode/' + episode + '?api_key=' + TMDB_KEY + '&language=fr-FR';
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      return {
        name: data.name || null,
        duration: data.runtime ? data.runtime + ' min' : null
      };
    })
    .catch(function() { return null; });
}

// ─── Helpers de décodage et redirection ──────────────────────

function resolveRedirect(url, referer) {
  return fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'User-Agent': MOVIX_UA, 'Referer': referer }
  }).then(function(res) { return res.url || url; })
    .catch(function() { return url; });
}

function resolveEmbed(embedUrl, referer) {
  return fetch(embedUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'User-Agent': MOVIX_UA, 'Referer': referer }
  })
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var patterns = [
        /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
        /source\s+src=["']([^"']+\.m3u8[^"']*)["']/i,
        /["']([^"']*\.m3u8(?:\?[^"']*)?)["']/i,
        /file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i
      ];
      for (var i = 0; i < patterns.length; i++) {
        var match = html.match(patterns[i]);
        if (match) {
          var url = match[1];
          if (url.startsWith('//')) url = 'https:' + url;
          if (url.startsWith('http')) return url;
        }
      }
      return null;
    })
    .catch(function() { return null; });
}

// ─── Helpers de Formatage UI ─────────────────────────────────

function parseLangInfo(lang) {
  if (!lang) return { icon: '🌍', label: 'MULTI' };
  var l = String(lang).toUpperCase();
  if (l.indexOf('VOSTFR') !== -1 || l.indexOf('VOST') !== -1) return { icon: '🔡', label: 'VOSTFR' };
  if (l.indexOf('VF') !== -1 || l.indexOf('FRENCH') !== -1 || l === 'FR') return { icon: '🇫🇷', label: 'VF' };
  if (l.indexOf('MULTI') !== -1) return { icon: '🌍', label: 'MULTI' };
  if (l.indexOf('VO') !== -1 || l.indexOf('EN') !== -1) return { icon: '🇬🇧', label: 'VO' };
  return { icon: '🌍', label: l };
}

function buildFormattedTitle(meta, mediaType, season, episode, epInfo, quality, langInfo, format, provider) {
  var line1 = '';
  if (mediaType === 'tv' && season && episode) {
    var epTitle = epInfo && epInfo.name ? ' - ' + epInfo.name : '';
    line1 = '🎬 S' + season + ' E' + episode + epTitle + ' | ' + meta.name;
  } else {
    line1 = '🎬 ' + meta.name + (meta.year ? ' (' + meta.year + ')' : '');
  }

  var specs = [
    '📺 ' + quality,
    langInfo.icon + ' ' + langInfo.label,
    '🎞️ ' + format.toUpperCase()
  ];

  var duration = (mediaType === 'tv' && epInfo && epInfo.duration) ? epInfo.duration : meta.duration;
  if (duration) specs.push('⏱️ ' + duration);
  if (provider) specs.push('📡 ' + provider);

  return line1 + '\n' + specs.join(' | ');
}

// ─── Extraction des APIs Movix ───────────────────────────────

// API 1 : Purstream — m3u8 direct
function fetchPurstream(apiBase, referer, tmdbId, mediaType, season, episode) {
  var url = mediaType === 'tv'
    ? apiBase + '/api/purstream/tv/' + tmdbId + '/stream?season=' + (season || 1) + '&episode=' + (episode || 1)
    : apiBase + '/api/purstream/movie/' + tmdbId + '/stream';

  console.log('[Movix] Purstream:', url);
  return fetch(url, {
    method: 'GET',
    headers: { 'Referer': referer, 'Origin': referer.replace(/\/$/, ''), 'User-Agent': MOVIX_UA }
  })
    .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function(data) {
      if (!data || !data.sources || data.sources.length === 0) throw new Error('Vide');
      return data.sources; // Structure : [{ url: "...", name: "..." }]
    });
}

// API 2 : Cpasmal
function fetchCpasmal(apiBase, referer, tmdbId, mediaType, season, episode) {
  var url = mediaType === 'tv'
    ? apiBase + '/api/cpasmal/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1)
    : apiBase + '/api/cpasmal/movie/' + tmdbId;

  console.log('[Movix] Cpasmal:', url);
  return fetch(url, {
    method: 'GET',
    headers: { 'Referer': referer, 'Origin': referer.replace(/\/$/, ''), 'User-Agent': MOVIX_UA }
  })
    .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function(data) {
      if (!data || !data.links) throw new Error('Vide');
      var sources = [];
      var langs = ['vf', 'vostfr'];
      langs.forEach(function(lang) {
        if (data.links[lang]) {
          data.links[lang].forEach(function(link) {
            sources.push({ url: link.url, name: 'Cpasmal', player: link.server, lang: lang });
          });
        }
      });
      return sources;
    });
}

// API 3 : FStream
function fetchFstream(apiBase, referer, tmdbId, mediaType, season, episode) {
  var url = mediaType === 'tv'
    ? apiBase + '/api/fstream/tv/' + tmdbId + '/season/' + (season || 1)
    : apiBase + '/api/fstream/movie/' + tmdbId;

  console.log('[Movix] FStream:', url);
  return fetch(url, {
    method: 'GET',
    headers: { 'Referer': referer, 'Origin': referer.replace(/\/$/, ''), 'User-Agent': MOVIX_UA }
  })
    .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function(data) {
      if (mediaType === 'tv') {
        if (!data || !data.episodes) throw new Error('Vide');
        var ep = String(episode || 1);
        var episodeData = data.episodes[ep];
        if (!episodeData) throw new Error('Épisode non trouvé');
        return parseFstreamData(episodeData);
      } else {
        // Mode film : la réponse est directement l'objet contenant les langues
        if (!data || !data.languages) throw new Error('Vide');
        return parseFstreamData(data);
      }
    });
}

function parseFstreamData(obj) {
  var sources = [];
  if (!obj.languages) return sources;
  ['VF', 'VOSTFR'].forEach(function(lang) {
    if (obj.languages[lang]) {
      obj.languages[lang].forEach(function(source) {
        sources.push({ url: source.url, name: 'FStream', player: source.player, lang: lang });
      });
    }
  });
  return sources;
}

// API 4 : Darkino (Nightflix)
function fetchDarkino(apiBase, referer, tmdbId, mediaType, season, episode, meta, epInfo) {
  var headers = { 'Referer': referer, 'Origin': referer.replace(/\/$/, ''), 'User-Agent': MOVIX_UA };
  console.log('[Movix] Darkino recherche pour: "' + meta.name + '"');

  return fetch(apiBase + '/api/search?title=' + encodeURIComponent(meta.name), { method: 'GET', headers: headers })
    .then(function(res) { if (!res.ok) throw new Error('Search ' + res.status); return res.json(); })
    .then(function(data) {
      var results = (data && data.results) ? data.results : [];
      var match = null;
      for (var i = 0; i < results.length; i++) {
        if (String(results[i].tmdb_id) === String(tmdbId)) { match = results[i]; break; }
      }
      if (!match) throw new Error('tmdb_id non trouvé sur Darkino');

      var downloadUrl = apiBase + '/api/films/download/' + match.id;
      if (mediaType === 'tv' && season && episode) downloadUrl += '?season=' + season + '&episode=' + episode;

      return fetch(downloadUrl, { method: 'GET', headers: headers })
        .then(function(res) { if (!res.ok) throw new Error('Download ' + res.status); return res.json(); })
        .then(function(data) {
          if (!data || !data.sources || data.sources.length === 0) throw new Error('Vide');
          
          return data.sources
            .filter(function(s) { return s.m3u8 && s.m3u8.includes('.m3u8'); })
            .map(function(s) {
              var q = s.quality || 'HD';
              var langInfo = parseLangInfo(s.language || 'MULTI');
              return {
                name: 'Movix - ' + q,
                title: buildFormattedTitle(meta, mediaType, season, episode, epInfo, q, langInfo, 'm3u8', 'Nightflix'),
                url: s.m3u8,
                quality: q,
                lang: langInfo.label,
                format: 'm3u8',
                headers: { 'User-Agent': MOVIX_UA, 'Referer': 'https://darkibox.com/' }
              };
            });
        });
    });
}

// ─── Traitement et Uniformisation Globale ───────────────────

var UNSUPPORTED_PLAYERS = ['netu', 'voe', 'uqload', 'doodstream', 'vidoza', 'younetu', 'bysebuho', 'kakaflix', 'ralphy'];

function processEmbedSources(sources, referer, meta, mediaType, season, episode, epInfo) {
  var supportedSources = sources.filter(function(source) {
    var urlLower = source.url.toLowerCase();
    return !UNSUPPORTED_PLAYERS.some(function(player) { return urlLower.indexOf(player) !== -1; });
  });

  if (supportedSources.length === 0) return Promise.resolve([]);

  return Promise.all(supportedSources.slice(0, 8).map(function(source) {
    return resolveEmbed(source.url, referer).then(function(directUrl) {
      if (!directUrl) return null;
      
      var isMp4 = directUrl.match(/\.mp4/i);
      var isM3u8 = directUrl.match(/\.m3u8/i);
      if (!isMp4 && !isM3u8) return null;

      var quality = 'HD';
      var langInfo = parseLangInfo(source.lang);
      var format = isMp4 ? 'mp4' : 'm3u8';
      var provider = source.name + ' (' + (source.player || 'Direct') + ')';

      return {
        name: 'Movix - ' + quality,
        title: buildFormattedTitle(meta, mediaType, season, episode, epInfo, quality, langInfo, format, provider),
        url: directUrl,
        quality: quality,
        lang: langInfo.label,
        format: format,
        headers: { 'Referer': referer, 'User-Agent': MOVIX_UA }
      };
    });
  })).then(function(results) {
    return results.filter(function(r) { return r !== null; });
  });
}

function tryFetchAll(apiBase, referer, tmdbId, mediaType, season, episode, meta, epInfo) {
  // Tentative 1 : Purstream
  return fetchPurstream(apiBase, referer, tmdbId, mediaType, season, episode)
    .then(function(sources) {
      return Promise.all(sources.map(function(source) {
        return resolveRedirect(source.url, referer).then(function(resolvedUrl) {
          var q = source.name && source.name.indexOf('1080') !== -1 ? '1080p' : '720p';
          var langInfo = parseLangInfo(source.name);
          var format = source.format || 'm3u8';

          return {
            name: 'Movix - ' + q,
            title: buildFormattedTitle(meta, mediaType, season, episode, epInfo, q, langInfo, format, 'Purstream'),
            url: resolvedUrl,
            quality: q,
            lang: langInfo.label,
            format: format.toLowerCase(),
            headers: { 'User-Agent': MOVIX_UA }
          };
        });
      }));
    })
    .catch(function() {
      // Tentative 2 (Fallback) : Cpasmal + FStream + Darkino
      console.log('[Movix] Purstream indisponible, agrégation des fallbacks...');
      return Promise.all([
        fetchCpasmal(apiBase, referer, tmdbId, mediaType, season, episode).catch(function() { return []; }),
        fetchFstream(apiBase, referer, tmdbId, mediaType, season, episode).catch(function() { return []; }),
        fetchDarkino(apiBase, referer, tmdbId, mediaType, season, episode, meta, epInfo).catch(function() { return []; })
      ]).then(function(results) {
        var embedSources = results[0].concat(results[1]);
        var darkinoSources = results[2];
        
        return processEmbedSources(embedSources, referer, meta, mediaType, season, episode, epInfo)
          .then(function(resolvedEmbeds) {
            var all = darkinoSources.concat(resolvedEmbeds);
            if (all.length === 0) throw new Error('Aucune source trouvée sur l\'ensemble des API');
            return all;
          });
      });
    });
}

// ─── Point d'entrée principal ────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[Movix] START tmdbId=' + tmdbId + ' type=' + mediaType + ' S' + season + 'E' + episode);

  var endpoint;
  var meta;
  var epInfo;

  return Promise.all([
    detectApi(),
    getTmdbMetadata(tmdbId, mediaType),
    mediaType === 'tv' ? getEpisodeInfo(tmdbId, season, episode) : Promise.resolve(null)
  ])
    .then(function(results) {
      endpoint = results[0];
      meta = results[1];
      epInfo = results[2];

      if (!endpoint) throw new Error('Détection endpoint échouée');
      return tryFetchAll(endpoint.api, endpoint.referer, tmdbId, mediaType, season, episode, meta, epInfo);
    })
    .catch(function(err) {
      console.error('[Movix] Erreur globale:', err.message || err);
      return [];
    });
}

// ─── Export ──────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
