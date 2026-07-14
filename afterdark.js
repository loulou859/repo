// =============================================================
// Provider : 4AfterDark (VF/VOSTFR/MULTI)
// Version : 2.2.0
//
// API :
// - Sources : GET /api/staging-20260420-yuna-hipaa-86nnorn0/sources
//   Params: tmdbId, type, imdbId, title, releaseYear, originalTitle
//   Response: NDJSON avec providers (tokyo, copenhague, canberra, paris, etc.)
//
// Domaine dynamique via domains.json (clé "aftdrk")
// Fallback: 5afterdark.mom
// =============================================================

var DOMAINS_URL = 'https://raw.githubusercontent.com/iokza/NoAds4Website/refs/heads/main/domains.json';
var AFTERDARK_DOMAIN = '5afterdark.mom';
var AFTERDARK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';
var API_PATH = '/api/staging-20260420-yuna-hipaa-86nnorn0/sources';

var _cachedEndpoint = null;

// ─── Construction de l'endpoint ──────────────────────────────

function buildEndpoint(domain) {
  return {
    base: 'https://' + domain,
    api: 'https://' + domain + API_PATH,
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
      var tld = data['aftdrk'];
      if (!tld) throw new Error('Clé "aftdrk" absente');
      AFTERDARK_DOMAIN = tld;
      console.log('[4AfterDark] Domaine:', AFTERDARK_DOMAIN);
      _cachedEndpoint = buildEndpoint(AFTERDARK_DOMAIN);
      return _cachedEndpoint;
    })
    .catch(function(err) {
      console.warn('[4AfterDark] Fallback domain:', err.message);
      _cachedEndpoint = buildEndpoint('5afterdark.mom');
      return _cachedEndpoint;
    });
}

// ─── Headers ─────────────────────────────────────────────────

function getHeaders(endpoint) {
  return {
    'User-Agent': AFTERDARK_UA,
    'Referer': endpoint.referer,
    'Origin': endpoint.base,
    'Accept': 'application/x-ndjson, application/json, */*'
  };
}

// ─── TMDB ────────────────────────────────────────────────────

function getTmdbData(tmdbId, mediaType) {
  var type = mediaType === 'tv' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + type + '/' + tmdbId +
            '?api_key=' + TMDB_KEY +
            '&language=fr-FR&append_to_response=external_ids';

  return fetch(url)
    .then(function(res) {
      if (!res.ok) throw new Error('TMDB HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      var releaseDate = data.release_date || data.first_air_date || '';
      return {
        tmdbId: String(tmdbId),
        imdbId: (data.external_ids && data.external_ids.imdb_id) || data.imdb_id || '',
        title: data.title || data.name || '',
        originalTitle: data.original_title || data.original_name || '',
        year: releaseDate.split('-')[0] || '',
        runtime: data.runtime ? data.runtime + ' min' : '',
        numberOfSeasons: data.number_of_seasons || 0
      };
    });
}

function getEpisodeInfo(tmdbId, season, episode) {
  if (!tmdbId || !season || !episode) return Promise.resolve(null);

  var url = 'https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + season + '/episode/' + episode +
            '?api_key=' + TMDB_KEY + '&language=fr-FR';

  return fetch(url)
    .then(function(res) {
      if (!res.ok) return null;
      return res.json();
    })
    .then(function(data) {
      if (!data) return null;
      return {
        name: data.name || null,
        duration: data.runtime ? data.runtime + ' min' : null
      };
    })
    .catch(function() { return null; });
}

// ─── Appel API Sources ───────────────────────────────────────

function fetchSources(endpoint, tmdbData, mediaType, season, episode) {
  var params = [];

  params.push('tmdbId=' + encodeURIComponent(tmdbData.tmdbId));
  params.push('type=' + (mediaType === 'tv' ? 'tv' : 'movie'));

  if (tmdbData.imdbId) {
    params.push('imdbId=' + encodeURIComponent(tmdbData.imdbId));
  }
  if (tmdbData.title) {
    params.push('title=' + encodeURIComponent(tmdbData.title));
  }
  if (tmdbData.year) {
    params.push('releaseYear=' + encodeURIComponent(tmdbData.year));
  }
  if (tmdbData.originalTitle) {
    params.push('originalTitle=' + encodeURIComponent(tmdbData.originalTitle));
  }

  if (mediaType === 'tv' && season && episode) {
    params.push('season=' + season);
    params.push('episode=' + episode);
  }

  var url = endpoint.api + '?' + params.join('&');
  console.log('[4AfterDark] API URL:', url);

  return fetch(url, {
    method: 'GET',
    headers: getHeaders(endpoint)
  })
    .then(function(res) {
      console.log('[4AfterDark] API status:', res.status);
      if (!res.ok) throw new Error('API HTTP ' + res.status);
      return res.text();
    })
    .then(function(text) {
      console.log('[4AfterDark] Raw response (' + text.length + ' chars)');
      return parseNdjson(text);
    });
}

// ─── Parser NDJSON ───────────────────────────────────────────

function parseNdjson(text) {
  if (!text || text.trim() === '') return [];

  var lines = text.trim().split('\n');
  var results = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    try {
      var obj = JSON.parse(line);
      results.push(obj);
    } catch (e) {
      console.warn('[4AfterDark] Parse error line', i);
    }
  }

  return results;
}

// ─── Helpers ─────────────────────────────────────────────────

function parseLangInfo(lang) {
  if (!lang) return { icon: '🌍', label: 'MULTI' };

  var l = String(lang).toUpperCase();

  if (l.indexOf('VOSTFR') !== -1 || l.indexOf('VOST') !== -1) return { icon: '🔡', label: 'VOSTFR' };
  if (l === 'VFF') return { icon: '🇫🇷', label: 'VFF' };
  if (l === 'VFQ') return { icon: '🇨🇦', label: 'VFQ' };
  if (l.indexOf('VF') !== -1 || l.indexOf('FRENCH') !== -1 || l === 'FR') return { icon: '🇫🇷', label: 'VF' };
  if (l.indexOf('MULTI') !== -1) return { icon: '🌍', label: 'MULTI' };
  if (l.indexOf('VO') !== -1 || l.indexOf('EN') !== -1 || l === 'ENGLISH') return { icon: '🇬🇧', label: 'VO' };

  return { icon: '🌍', label: l || 'MULTI' };
}

function parseQuality(quality) {
  if (!quality) return 'HD';
  var q = String(quality).toUpperCase();
  if (q.indexOf('4K') !== -1 || q.indexOf('2160') !== -1) return '4K';
  if (q.indexOf('1080') !== -1 || q === 'FHD') return '1080p';
  if (q.indexOf('720') !== -1) return '720p';
  if (q === 'HD') return 'HD';
  if (q === 'SD' || q.indexOf('480') !== -1) return 'SD';
  if (q === 'UNKNOWN') return 'HD';
  return q || 'HD';
}

// Déterminer le vrai type de stream depuis l'URL si le type API est vague
function resolveStreamType(item) {
  var apiType = String(item.type || '').toLowerCase();
  var url = item.url || '';

  // Si l'API dit HLS ou MP4 explicitement, on fait confiance
  if (apiType === 'hls') return 'hls';
  if (apiType === 'mp4') return 'mp4';

  // Pour "embed" ou "unknown", regarder l'URL
  if (url.indexOf('.m3u8') !== -1) return 'hls';
  if (url.indexOf('.mp4') !== -1) return 'mp4';

  // URL proxy = généralement HLS résolu
  if (url.indexOf('proxy.taekong.space') !== -1) return 'hls';

  // URLs connues comme embed
  if (url.indexOf('/embed') !== -1 || url.indexOf('/e/') !== -1) return 'embed';

  return apiType || 'embed';
}

function getServicePriority(service, proxied, streamType, quality) {
  var score = 0;

  // ── Type de stream (direct mieux que embed) ──
  if (streamType === 'hls') score += 200;
  else if (streamType === 'mp4') score += 150;
  else if (streamType === 'embed') score += 50;

  // ── Proxied = déjà résolu, stream direct ──
  if (proxied) score += 100;

  // ── Qualité ──
  if (quality === '4K') score += 40;
  else if (quality === '1080p') score += 35;
  else if (quality === 'HD') score += 30;
  else if (quality === '720p') score += 25;
  else if (quality === 'SD') score += 10;

  // ── Services de qualité ──
  var svc = String(service).toLowerCase();
  var top = ['thais', 'vidzy', 'fsvid', 'vidara'];
  var good = ['voe', 'afroditi', 'iris', 'hera'];
  var mid = ['dropload', 'lulustream', 'doodstream', 'dsvplay'];
  var low = ['uqload', 'netu', 'ups2up'];

  if (top.indexOf(svc) !== -1) score += 20;
  else if (good.indexOf(svc) !== -1) score += 15;
  else if (mid.indexOf(svc) !== -1) score += 10;
  else if (low.indexOf(svc) !== -1) score += 5;
  else score += 8;

  return score;
}

// ─── Normalisation ───────────────────────────────────────────

function normalizeSources(ndjsonData, tmdbData, mediaType, season, episode, epInfo) {
  var results = [];
  var seenUrls = {};

  for (var p = 0; p < ndjsonData.length; p++) {
    var providerData = ndjsonData[p];
    var providerId = providerData.id || 'unknown';
    var items = providerData.items || [];

    console.log('[4AfterDark] Provider:', providerId, '→', items.length, 'items');

    for (var i = 0; i < items.length; i++) {
      var item = items[i];

      var streamUrl = item.url;
      if (!streamUrl) continue;

      // Dédoublonnage par URL
      if (seenUrls[streamUrl]) continue;
      seenUrls[streamUrl] = true;

      var streamType = resolveStreamType(item);
      var service = item.service || providerId;
      var proxied = item.proxied === true;
      var quality = parseQuality(item.quality);
      var langInfo = parseLangInfo(item.language);
      var providerName = item.provider || providerId;

      var priority = getServicePriority(service, proxied, streamType, quality);

      // ── Titre formaté ──
      var line1 = '🎬 ';
      if (mediaType === 'tv' && season && episode) {
        var epTitle = epInfo && epInfo.name ? ' - ' + epInfo.name : '';
        line1 += 'S' + season + 'E' + episode + epTitle + ' | ' + tmdbData.title;
      } else {
        line1 += tmdbData.title + (tmdbData.year ? ' (' + tmdbData.year + ')' : '');
      }

      var typeLabel = streamType === 'hls' ? 'HLS' : streamType === 'mp4' ? 'MP4' : 'EMBED';
      var specs = [
        '📺 ' + quality,
        langInfo.icon + ' ' + langInfo.label,
        '🎞️ ' + typeLabel,
        '📡 ' + providerName + ' / ' + service
      ];

      var duration = epInfo && epInfo.duration ? epInfo.duration : tmdbData.runtime;
      if (duration) specs.push('⏱️ ' + duration);
      if (proxied) specs.push('🔒 Proxy');

      results.push({
        name: '4AfterDark - ' + quality + ' ' + langInfo.label,
        title: line1 + '\n' + specs.join(' | '),
        url: streamUrl,
        quality: quality,
        lang: langInfo.label,
        format: streamType,
        priority: priority,
        headers: {
          'User-Agent': AFTERDARK_UA,
          'Referer': 'https://' + AFTERDARK_DOMAIN + '/'
        }
      });
    }
  }

  // Tri par priorité décroissante
  results.sort(function(a, b) {
    return (b.priority || 0) - (a.priority || 0);
  });

  // Limiter à 20 sources
  if (results.length > 20) {
    results = results.slice(0, 20);
  }

  console.log('[4AfterDark] Total sources:', results.length);
  return results;
}

// ─── Point d'entrée ──────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[4AfterDark] START tmdbId=' + tmdbId + ' type=' + mediaType +
    ' S' + (season || '-') + 'E' + (episode || '-'));

  var endpoint, tmdbData, epInfo;

  return detectEndpoint()
    .then(function(ep) {
      endpoint = ep;
      return getTmdbData(tmdbId, mediaType);
    })
    .then(function(data) {
      tmdbData = data;
      console.log('[4AfterDark] TMDB:', tmdbData.title, '| imdb:', tmdbData.imdbId);
      if (mediaType === 'tv' && season && episode) {
        return getEpisodeInfo(tmdbId, season, episode);
      }
      return null;
    })
    .then(function(info) {
      epInfo = info;
      return fetchSources(endpoint, tmdbData, mediaType, season, episode);
    })
    .then(function(ndjsonData) {
      if (ndjsonData.length === 0) {
        console.log('[4AfterDark] Aucune donnée de l\'API');
        return [];
      }
      return normalizeSources(ndjsonData, tmdbData, mediaType, season, episode, epInfo);
    })
    .catch(function(err) {
      console.error('[4AfterDark] ERROR:', err.message || err);
      return [];
    });
}

// ─── Export ──────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else if (typeof global !== 'undefined') {
  global.getStreams = getStreams;
}
