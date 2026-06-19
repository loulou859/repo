// =============================================================
// Provider : Webflix (VF français)
// Version : 1.0.0
// 
// API :
// - Films : GET /api/fastflux?type=movie&tmdb_id={tmdbId}
// - Séries : GET /api/fastflux?type=tv&tmdb_id={tmdbId}&season={s}&episode={e}
// 
// Domaine dynamique via domains.json (clé "wbflix")
// Fallback: webflix.lol
// =============================================================

var DOMAINS_URL = 'https://raw.githubusercontent.com/iokza/NoAds4Website/refs/heads/main/domains.json';
var WEBFLIX_DOMAIN = 'webflix.lol'; // fallback
var WEBFLIX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';

var _cachedEndpoint = null;

// ─── Construction de l'endpoint ──────────────────────────────

function buildEndpoint(domain) {
  return {
    base: 'https://' + domain,
    api: 'https://' + domain + '/api/fastflux',
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
      var tld = data['wbflix'];
      if (!tld) throw new Error('Clé "wbflix" absente du domains.json');
      WEBFLIX_DOMAIN = 'webflix.' + tld;
      console.log('[Webflix] Domaine récupéré:', WEBFLIX_DOMAIN);
      _cachedEndpoint = buildEndpoint(WEBFLIX_DOMAIN);
      return _cachedEndpoint;
    })
    .catch(function(err) {
      console.warn('[Webflix] domains.json échoué:', err.message, '— fallback webflix.lol');
      _cachedEndpoint = buildEndpoint('webflix.lol');
      return _cachedEndpoint;
    });
}

// ─── Headers ─────────────────────────────────────────────────

function getHeaders(endpoint) {
  return {
    'User-Agent': WEBFLIX_UA,
    'Referer': endpoint.referer,
    'Origin': endpoint.base,
    'Accept': 'application/json'
  };
}

// ─── TMDB Helpers ────────────────────────────────────────────

function getTmdbMetadata(tmdbId, type) {
  var url = 'https://api.themoviedb.org/3/' + (type === 'tv' ? 'tv' : 'movie') + '/' + tmdbId +
            '?api_key=' + TMDB_KEY + '&language=fr-FR';
  
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      return {
        name: data.title || data.name || 'Webflix',
        year: (data.release_date || data.first_air_date || '').split('-')[0],
        duration: data.runtime ? data.runtime + ' min' : ''
      };
    })
    .catch(function() {
      return { name: 'Webflix', year: '', duration: '' };
    });
}

function getEpisodeInfo(tmdbId, season, episode) {
  if (!tmdbId || !season || !episode) return Promise.resolve(null);
  
  var url = 'https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + season + '/episode/' + episode +
            '?api_key=' + TMDB_KEY + '&language=fr-FR';
  
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

// ─── Récupération des sources ────────────────────────────────

function fetchSources(endpoint, tmdbId, mediaType, season, episode) {
  var url = endpoint.api + '?type=' + (mediaType === 'tv' ? 'tv' : 'movie') + '&tmdb_id=' + tmdbId;
  
  if (mediaType === 'tv' && season && episode) {
    url += '&season=' + season + '&episode=' + episode;
  }
  
  console.log('[Webflix] Fetching:', url);
  
  return fetch(url, { method: 'GET', headers: getHeaders(endpoint) })
    .then(function(res) {
      if (!res.ok) throw new Error('API HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      console.log('[Webflix] Response: success=' + data.success + ' available=' + data.available);
      
      if (!data.success || !data.available || !data.data) {
        return null;
      }
      
      return data.data;
    });
}

// ─── Helpers de formatage ────────────────────────────────────

function parseLangInfo(lang) {
  if (!lang) return { icon: '🌍', label: 'MULTI' };
  var l = String(lang).toUpperCase();
  if (l.indexOf('VOSTFR') !== -1) return { icon: '🔡', label: 'VOSTFR' };
  if (l.indexOf('VF') !== -1 || l === 'FR' || l === 'FRENCH') return { icon: '🇫🇷', label: 'VF' };
  if (l.indexOf('MULTI') !== -1) return { icon: '🌍', label: 'MULTI' };
  if (l.indexOf('VO') !== -1 || l === 'EN') return { icon: '🇬🇧', label: 'VO' };
  return { icon: '🌍', label: l || 'MULTI' };
}

function parseQuality(q) {
  if (!q || q === 'Unknown') return 'HD';
  var s = String(q).toUpperCase();
  if (s.indexOf('4K') !== -1 || s.indexOf('2160') !== -1) return '4K';
  if (s.indexOf('1080') !== -1) return '1080p';
  if (s.indexOf('720') !== -1) return '720p';
  if (s.indexOf('480') !== -1) return '480p';
  return s || 'HD';
}

function detectFormat(url, type) {
  if (type) {
    var t = type.toLowerCase();
    if (t === 'mp4') return 'MP4';
    if (t === 'hls' || t === 'm3u8') return 'M3U8';
  }
  if (!url) return 'MP4';
  if (url.indexOf('.m3u8') !== -1) return 'M3U8';
  if (url.indexOf('.mp4') !== -1) return 'MP4';
  return 'MP4';
}

// ─── Normalisation avec UI formatée ──────────────────────────

function normalizeSource(source, meta, mediaType, season, episode, epInfo) {
  var streamUrl = source.url;
  if (!streamUrl) return null;
  
  // Utiliser le titre depuis l'API Webflix si dispo, sinon TMDB
  var title = source.title || meta.name;
  var year = source.year || meta.year;
  var quality = parseQuality(source.quality);
  var langInfo = parseLangInfo(source.language);
  var format = detectFormat(streamUrl, source.type);
  
  // ─── Construction du titre formaté ───────────────────────
  var line1 = '🎬 ';
  if (mediaType === 'tv' && season && episode) {
    var epTitle = epInfo && epInfo.name ? ' - ' + epInfo.name : '';
    line1 += 'S' + season + ' E' + episode + epTitle + ' | ' + title;
  } else {
    line1 += title + (year ? ' (' + year + ')' : '');
  }
  
  var specs = [
    '📺 ' + quality,
    langInfo.icon + ' ' + langInfo.label,
    '🎞️ ' + format
  ];
  
  // Durée
  var duration = epInfo && epInfo.duration ? epInfo.duration : meta.duration;
  if (duration) specs.push('⏱️ ' + duration);
  
  // Taille du fichier
  if (source.size) specs.push('💾 ' + source.size);
  
  return {
    name: 'Webflix - ' + quality + ' ' + langInfo.label,
    title: line1 + '\n' + specs.join(' | '),
    url: streamUrl,
    quality: quality,
    lang: langInfo.label,
    format: format.toLowerCase(),
    headers: {
      'User-Agent': WEBFLIX_UA,
      'Referer': 'https://' + WEBFLIX_DOMAIN + '/'
    }
  };
}

// ─── Point d'entrée principal ────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[Webflix] START tmdbId=' + tmdbId + ' type=' + mediaType + ' S' + season + 'E' + episode);
  
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
      
      return fetchSources(endpoint, tmdbId, mediaType, season, episode);
    })
    .then(function(source) {
      if (!source) {
        console.log('[Webflix] Contenu non disponible');
        return [];
      }
      
      var result = normalizeSource(source, meta, mediaType, season, episode, epInfo);
      if (!result) return [];
      
      console.log('[Webflix] 1 source trouvée:', result.quality, result.lang);
      return [result];
    })
    .catch(function(err) {
      console.error('[Webflix] Erreur:', err.message || err);
      return [];
    });
}

// ─── Export ──────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}


// =============================================================
// DOCUMENTATION API WEBFLIX
// =============================================================
// 
// DOMAINE DYNAMIQUE :
// - Récupéré depuis domains.json (clé "wbflix")
// - Exemple: "wbflix": "lol" → webflix.lol
// - Fallback: webflix.lol
// 
// ENDPOINTS :
// 
// 1. Sources film :
//    GET /api/fastflux?type=movie&tmdb_id={tmdbId}
// 
// 2. Sources série :
//    GET /api/fastflux?type=tv&tmdb_id={tmdbId}&season={s}&episode={e}
// 
// RESPONSE :
// {
//   "success": true,
//   "available": true,
//   "data": {
//     "tmdb_id": 1477317,
//     "title": "À contre-sens 2 : Londres",
//     "year": 2026,
//     "url": "https://cdn.fastflux.xyz/movies/Your-Fault-London-2026.mp4",
//     "type": "mp4",
//     "quality": "Unknown",
//     "language": "VF",
//     "size": "1.11 GB",
//     "added_at": "2026-06-17 10:44:19"
//   }
// }
// 
// =============================================================
