// =============================================================
// Provider : Purstream (VF/VOSTFR/MULTI français)
// Version : 4.0.1
// Compatible Desktop: language/provider au lieu de lang/format
// =============================================================

var DOMAINS_URL = 'https://raw.githubusercontent.com/iokza/NoAds4Website/refs/heads/main/domains.json';
var PURSTREAM_DOMAIN = 'purstream.art';
var PURSTREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var TMDB_KEY = '2dca580c2a14b55200e784d157207b4d';

var _cachedEndpoint = null;

function buildEndpoint(domain) {
  return {
    base: 'https://' + domain,
    api: 'https://api.' + domain + '/api/v1',
    referer: 'https://' + domain + '/'
  };
}

function detectEndpoint() {
  if (_cachedEndpoint) return Promise.resolve(_cachedEndpoint);

  return fetch(DOMAINS_URL)
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      var tld = data['ps'];
      if (!tld) throw new Error('Clé "ps" absente du domains.json');
      PURSTREAM_DOMAIN = 'purstream.' + tld;
      console.log('[Purstream] Domaine récupéré:', PURSTREAM_DOMAIN);
      _cachedEndpoint = buildEndpoint(PURSTREAM_DOMAIN);
      return _cachedEndpoint;
    })
    .catch(function(err) {
      console.warn('[Purstream] domains.json échoué:', err.message, '— fallback purstream.art');
      _cachedEndpoint = buildEndpoint('purstream.art');
      return _cachedEndpoint;
    });
}

function getHeaders(endpoint) {
  return {
    'User-Agent': PURSTREAM_UA,
    'Referer': endpoint.referer,
    'Origin': endpoint.base,
    'Accept': 'application/json'
  };
}

function getTmdbMetadata(tmdbId, type) {
  var url = 'https://api.themoviedb.org/3/' + (type === 'tv' ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=fr-FR';

  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      return {
        name: data.title || data.name || 'Purstream',
        year: (data.release_date || data.first_air_date || '').split('-')[0],
        duration: data.runtime ? data.runtime + ' min' : ''
      };
    })
    .catch(function() {
      return { name: 'Purstream', year: '', duration: '' };
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

function getTitleFromTmdb(tmdbId, mediaType) {
  var type = mediaType === 'tv' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + type + '/' + tmdbId + '?language=fr-FR&api_key=' + TMDB_KEY;

  return fetch(url, { method: 'GET', headers: { 'User-Agent': PURSTREAM_UA } })
    .then(function(res) {
      if (!res.ok) throw new Error('TMDB HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      var titleFr = data.title || data.name;
      var titleOrig = data.original_title || data.original_name;
      if (!titleFr && !titleOrig) throw new Error('Aucun titre TMDB');
      return { fr: titleFr, orig: titleOrig };
    });
}

function findPurstreamIdByTitle(endpoint, title, mediaType) {
  var encoded = encodeURIComponent(title);
  var url = endpoint.api + '/search-bar/search/' + encoded;

  console.log('[Purstream] Recherche:', url);

  return fetch(url, { method: 'GET', headers: getHeaders(endpoint) })
    .then(function(res) {
      if (!res.ok) throw new Error('Search HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      if (!data || !data.data || !data.data.items) throw new Error('Réponse vide');

      var items = data.data.items.movies && data.data.items.movies.items
        ? data.data.items.movies.items
        : [];

      if (items.length === 0) throw new Error('Aucun résultat pour: ' + title);

      var targetType = mediaType === 'tv' ? 'tv' : 'movie';
      var titleLower = title.toLowerCase();

      for (var i = 0; i < items.length; i++) {
        if (items[i].type === targetType && items[i].title && items[i].title.toLowerCase() === titleLower) {
          return items[i].id;
        }
      }
      for (var i = 0; i < items.length; i++) {
        if (items[i].title && items[i].title.toLowerCase() === titleLower) {
          return items[i].id;
        }
      }
      for (var i = 0; i < items.length; i++) {
        if (items[i].type === targetType) {
          return items[i].id;
        }
      }
      return items[0].id;
    });
}

function findPurstreamId(endpoint, tmdbId, mediaType) {
  return getTitleFromTmdb(tmdbId, mediaType)
    .then(function(titles) {
      return findPurstreamIdByTitle(endpoint, titles.fr, mediaType)
        .catch(function() {
          console.log('[Purstream] Titre FR échoué, essai titre original...');
          return findPurstreamIdByTitle(endpoint, titles.orig, mediaType);
        });
    });
}

function fetchMovieSources(endpoint, purstreamId) {
  var url = endpoint.api + '/media/' + purstreamId + '/sheet';
  console.log('[Purstream] Film sheet:', url);

  return fetch(url, { method: 'GET', headers: getHeaders(endpoint) })
    .then(function(res) {
      if (!res.ok) throw new Error('Sheet HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      if (!data || !data.data || !data.data.items) throw new Error('Sheet vide');
      return data.data.items;
    });
}

function fetchEpisodeSources(endpoint, purstreamId, season, episode) {
  var url = endpoint.api + '/stream/' + purstreamId + '/episode?season=' + (season || 1) + '&episode=' + (episode || 1);
  console.log('[Purstream] Série épisode:', url);

  return fetch(url, { method: 'GET', headers: getHeaders(endpoint) })
    .then(function(res) {
      if (!res.ok) throw new Error('Episode HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      if (!data || !data.data || !data.data.items) throw new Error('Episode vide');
      return data.data.items;
    });
}

function parseLangInfo(lang) {
  if (!lang) return { icon: '🌍', label: 'MULTI' };

  var l = String(lang).toUpperCase();

  if (l.indexOf('VOSTFR') !== -1 || l.indexOf('VOST') !== -1) return { icon: '🔡', label: 'VOSTFR' };
  if (l.indexOf('VF') !== -1 || l.indexOf('FRENCH') !== -1 || l === 'FR' || l === 'FRANÇAIS') return { icon: '🇫🇷', label: 'VF' };
  if (l.indexOf('MULTI') !== -1) return { icon: '🌍', label: 'MULTI' };
  if (l.indexOf('VO') !== -1 || l.indexOf('EN') !== -1 || l === 'ENGLISH') return { icon: '🇬🇧', label: 'VO' };

  return { icon: '🌍', label: 'MULTI' };
}

function parseQualityFromName(name) {
  if (!name) return 'HD';
  var n = name.toUpperCase();
  if (n.indexOf('4K') !== -1 || n.indexOf('2160') !== -1) return '4K';
  if (n.indexOf('1080') !== -1 || n.indexOf('FHD') !== -1) return '1080p';
  if (n.indexOf('720') !== -1) return '720p';
  if (n.indexOf('480') !== -1 || n.indexOf('SD') !== -1) return '480p';
  return 'HD';
}

function parseLangFromName(name) {
  if (!name) return 'MULTI';
  var n = name.toUpperCase();
  if (n.indexOf('VOSTFR') !== -1) return 'VOSTFR';
  if (n.indexOf('VF') !== -1) return 'VF';
  if (n.indexOf('MULTI') !== -1) return 'MULTI';
  if (n.indexOf('VO') !== -1) return 'VO';
  return 'MULTI';
}

function parseProviderFromName(name) {
  if (!name) return 'Purstream';
  var parts = name.split('|');
  if (parts.length > 0) return parts[0].trim() || 'Purstream';
  return 'Purstream';
}

function isDirectStream(url) {
  return url && (url.match(/\.m3u8/i) || url.match(/\.mp4/i));
}

function detectFormat(url) {
  if (!url) return 'mp4';
  if (url.indexOf('.m3u8') !== -1) return 'm3u8';
  if (url.indexOf('.mp4') !== -1) return 'mp4';
  return 'm3u8';
}

function normalizeMovieSources(endpoint, sheetData, meta) {
  var results = [];
  var urls = sheetData.urls || [];

  var title = sheetData.title || meta.name;
  var year = sheetData.releaseDate || meta.year;
  var runtime = sheetData.runtime ? sheetData.runtime.human : meta.duration;

  for (var i = 0; i < urls.length; i++) {
    var item = urls[i];
    var url = item.url;
    var name = item.name || '';

    if (!url) continue;
    if (!isDirectStream(url)) {
      console.log('[Purstream] Ignoré embed:', url);
      continue;
    }

    var quality = parseQualityFromName(name);
    var lang = parseLangFromName(name);
    var langInfo = parseLangInfo(lang);
    var provider = parseProviderFromName(name);
    var format = detectFormat(url).toUpperCase();

    var line1 = '🎬 ' + title + (year ? ' (' + year + ')' : '');

    var specs = [
      '📺 ' + quality,
      langInfo.icon + ' ' + langInfo.label,
      '🎞️ ' + format
    ];

    if (runtime) specs.push('⏱️ ' + runtime);
    if (provider && provider !== 'Purstream') specs.push('📡 ' + provider);

    results.push({
      name: 'Purstream - ' + quality,
      title: line1 + '\n' + specs.join(' | '),
      url: url,
      quality: quality,
      language: langInfo.label,
      provider: provider || 'Purstream',
      headers: {
        'User-Agent': PURSTREAM_UA,
        'Referer': endpoint.referer
      }
    });
  }

  return results;
}

function normalizeEpisodeSources(endpoint, episodeData, meta, season, episode, epInfo) {
  var results = [];
  var sources = episodeData.sources || [];

  for (var i = 0; i < sources.length; i++) {
    var item = sources[i];
    var url = item.stream_url;
    var name = item.source_name || '';

    if (!url) continue;

    var quality = parseQualityFromName(name);
    var lang = parseLangFromName(name);
    var langInfo = parseLangInfo(lang);
    var provider = parseProviderFromName(name);
    var format = (item.format || detectFormat(url)).toUpperCase();

    var epTitle = epInfo && epInfo.name ? ' - ' + epInfo.name : '';
    var line1 = '🎬 S' + season + ' E' + episode + epTitle + ' | ' + meta.name;

    var specs = [
      '📺 ' + quality,
      langInfo.icon + ' ' + langInfo.label,
      '🎞️ ' + format
    ];

    var duration = epInfo && epInfo.duration ? epInfo.duration : meta.duration;
    if (duration) specs.push('⏱️ ' + duration);
    if (provider && provider !== 'Purstream') specs.push('📡 ' + provider);

    results.push({
      name: 'Purstream - ' + quality,
      title: line1 + '\n' + specs.join(' | '),
      url: url,
      quality: quality,
      language: langInfo.label,
      provider: provider || 'Purstream',
      headers: {
        'User-Agent': PURSTREAM_UA,
        'Referer': endpoint.referer
      }
    });
  }

  return results;
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[Purstream] START tmdbId=' + tmdbId + ' type=' + mediaType + ' S' + season + 'E' + episode);

  var endpoint;
  var meta;
  var epInfo;

  return Promise.all([
    detectEndpoint(),
    getTmdbMetadata(tmdbId, mediaType),
    mediaType === 'tv' ? getEpisodeInfo(tmdbId, season, episode) : Promise.resolve(null)
  ])
    .then(function(results) {
      endpoint = results[0];
      meta = results[1];
      epInfo = results[2];
      return findPurstreamId(endpoint, tmdbId, mediaType);
    })
    .then(function(purstreamId) {
      console.log('[Purstream] purstreamId=' + purstreamId);

      if (mediaType === 'tv') {
        return fetchEpisodeSources(endpoint, purstreamId, season, episode)
          .then(function(data) {
            var sources = normalizeEpisodeSources(endpoint, data, meta, season, episode, epInfo);
            console.log('[Purstream] ' + sources.length + ' sources série trouvées');
            return sources;
          });
      } else {
        return fetchMovieSources(endpoint, purstreamId)
          .then(function(data) {
            var sources = normalizeMovieSources(endpoint, data, meta);
            console.log('[Purstream] ' + sources.length + ' sources film trouvées');
            return sources;
          });
      }
    })
    .catch(function(err) {
      console.error('[Purstream] Erreur:', err.message || err);
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
