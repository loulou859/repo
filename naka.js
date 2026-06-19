// =============================================================
// Provider : Nakastream (VF/VO français)
// Version : 2.0.0
// 
// API :
// 1. /api/v1/browse/by-tmdb/{type}/{tmdbId} → ID interne
// 2. /api/v1/streaming/sources/{internalId}?type={type} → Sources
// 
// Domaine dynamique via domains.json (clé "nks")
// =============================================================

var DOMAINS_URL = 'https://raw.githubusercontent.com/iokza/NoAds4Website/refs/heads/main/domains.json';
var NAKASTREAM_DOMAIN = 'nakastream.tv'; // fallback
var NAKASTREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';

var _cachedEndpoint = null;

// ─── Construction de l'endpoint ──────────────────────────────

function buildEndpoint(domain) {
  return {
    base: 'https://' + domain,
    api: 'https://' + domain + '/api/v1',
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
      var tld = data['naks'];
      if (!tld) throw new Error('Clé "naks" absente du domains.json');
      NAKASTREAM_DOMAIN = 'nakastream.' + tld;
      console.log('[Nakastream] Domaine récupéré:', NAKASTREAM_DOMAIN);
      _cachedEndpoint = buildEndpoint(NAKASTREAM_DOMAIN);
      return _cachedEndpoint;
    })
    .catch(function(err) {
      console.warn('[Nakastream] domains.json échoué:', err.message, '— fallback nakastream.tv');
      _cachedEndpoint = buildEndpoint('nakastream.tv');
      return _cachedEndpoint;
    });
}

// ─── Headers ─────────────────────────────────────────────────

function getHeaders(endpoint) {
  return {
    'User-Agent': NAKASTREAM_UA,
    'Referer': endpoint.referer,
    'Origin': endpoint.base,
    'Accept': 'application/json'
  };
}

// ─── TMDB Helpers (pour les métadonnées) ─────────────────────

function getTmdbMetadata(tmdbId, type) {
  var url = 'https://api.themoviedb.org/3/' + (type === 'tv' ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=fr-FR';
  
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var name = data.title || data.name || 'Nakastream';
      var date = data.release_date || data.first_air_date || '';
      var year = date ? date.split('-')[0] : '';
      
      var duration = '';
      if (type === 'movie' && data.runtime) {
        duration = data.runtime + ' min';
      } else if (type === 'tv' && data.episode_run_time && data.episode_run_time.length > 0) {
        duration = data.episode_run_time[0] + ' min';
      }
      
      return { name: name, year: year, duration: duration };
    })
    .catch(function() { 
      return { name: 'Nakastream', year: '', duration: '' }; 
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

// ─── Étape 1 : Récupérer l'ID interne depuis TMDB ID ─────────

function getInternalId(endpoint, tmdbId, mediaType) {
  var type = mediaType === 'tv' ? 'tv' : 'movie';
  var url = endpoint.api + '/browse/by-tmdb/' + type + '/' + tmdbId;
  
  console.log('[Nakastream] Getting internal ID:', url);
  
  return fetch(url, {
    method: 'GET',
    headers: getHeaders(endpoint)
  })
    .then(function(res) {
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Contenu non disponible sur Nakastream');
        }
        throw new Error('Browse HTTP ' + res.status);
      }
      return res.json();
    })
    .then(function(data) {
      console.log('[Nakastream] Browse response: id=' + data.id + ', title=' + data.title);
      
      if (!data.id) {
        throw new Error('ID interne non trouvé');
      }
      
      return {
        internalId: data.id,
        title: data.title || data.originalTitle,
        quality: data.quality,
        audioLanguages: data.audioLanguages || [],
        subtitleLanguages: data.subtitleLanguages || []
      };
    });
}

// ─── Étape 2 : Récupérer les sources ─────────────────────────

function fetchSources(endpoint, internalId, mediaType, season, episode) {
  var type = mediaType === 'tv' ? 'tv' : 'movie';
  var url = endpoint.api + '/streaming/sources/' + internalId + '?type=' + type;
  
  if (mediaType === 'tv' && season && episode) {
    url += '&season=' + season + '&episode=' + episode;
  }
  
  console.log('[Nakastream] Getting sources:', url);
  
  return fetch(url, {
    method: 'GET',
    headers: getHeaders(endpoint)
  })
    .then(function(res) {
      if (!res.ok) throw new Error('Sources HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      console.log('[Nakastream] Sources response received');
      return data;
    });
}

// ─── Helpers de formatage ────────────────────────────────────

function parseLangInfo(lang) {
  if (!lang) return { icon: '🌍', label: 'MULTI' };
  
  var l = String(lang).toUpperCase();
  
  if (l.indexOf('VOSTFR') !== -1 || l.indexOf('VOST') !== -1) {
    return { icon: '🔡', label: 'VOSTFR' };
  }
  if (l.indexOf('VF') !== -1 || l.indexOf('FRENCH') !== -1 || l === 'FR' || l === 'FRANÇAIS') {
    return { icon: '🇫🇷', label: 'VF' };
  }
  if (l.indexOf('MULTI') !== -1) {
    return { icon: '🌍', label: 'MULTI' };
  }
  if (l.indexOf('VO') !== -1 || l.indexOf('EN') !== -1 || l === 'ENGLISH') {
    return { icon: '🇬🇧', label: 'VO' };
  }
  
  return { icon: '🌍', label: 'MULTI' };
}

function detectFormat(url) {
  if (!url) return 'mp4';
  var urlLower = url.toLowerCase();
  if (urlLower.indexOf('.m3u8') !== -1) return 'm3u8';
  if (urlLower.indexOf('.mp4') !== -1) return 'mp4';
  if (urlLower.indexOf('.mkv') !== -1) return 'mkv';
  return 'm3u8';
}

function parseQuality(quality) {
  if (!quality) return 'HD';
  var q = String(quality).toUpperCase();
  if (q.indexOf('4K') !== -1 || q.indexOf('2160') !== -1) return '4K';
  if (q.indexOf('1080') !== -1 || q === 'FHD' || q === 'FULL HD') return '1080p';
  if (q.indexOf('720') !== -1 || q === 'HD') return '720p';
  if (q.indexOf('480') !== -1 || q === 'SD') return '480p';
  if (q.indexOf('360') !== -1) return '360p';
  return q;
}

// ─── Étape 3 : Normaliser avec UI formatée ───────────────────

function normalizeSources(endpoint, sourcesData, contentInfo, meta, season, episode, epInfo) {
  var results = [];
  
  // Extraire les sources selon la structure de réponse
  var sources = [];
  
  // Cas 1 : URL directe
  if (sourcesData.url || sourcesData.streamUrl || sourcesData.m3u8) {
    sources.push({
      url: sourcesData.url || sourcesData.streamUrl || sourcesData.m3u8,
      quality: sourcesData.quality,
      lang: sourcesData.language || sourcesData.lang
    });
  }
  // Cas 2 : Array de sources
  else if (Array.isArray(sourcesData.sources)) {
    sources = sourcesData.sources;
  }
  else if (Array.isArray(sourcesData.streams)) {
    sources = sourcesData.streams;
  }
  else if (Array.isArray(sourcesData.data)) {
    sources = sourcesData.data;
  }
  else if (Array.isArray(sourcesData)) {
    sources = sourcesData;
  }
  // Cas 3 : Objet avec qualités comme clés
  else {
    var keys = Object.keys(sourcesData);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var val = sourcesData[key];
      if (typeof val === 'string' && (val.indexOf('.m3u8') !== -1 || val.indexOf('http') === 0)) {
        sources.push({ url: val, quality: key });
      } else if (typeof val === 'object' && val.url) {
        sources.push(val);
      }
    }
  }
  
  // Normaliser chaque source
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    var streamUrl = src.url || src.stream_url || src.streamUrl || src.file || src.m3u8 || src.link;
    
    if (!streamUrl) continue;
    
    // Rendre l'URL absolue si relative
    if (streamUrl.charAt(0) === '/') {
      streamUrl = endpoint.base + streamUrl;
    }
    
    var quality = parseQuality(src.quality || src.resolution || src.label || contentInfo.quality);
    var langInfo = parseLangInfo(src.lang || src.language || src.audio);
    var format = detectFormat(streamUrl).toUpperCase();
    
    // ─── Construction du titre formaté (style Nakios) ────────
    var line1 = '🎬 ';
    if (season && episode) {
      var epTitle = epInfo && epInfo.name ? ' - ' + epInfo.name : '';
      line1 += 'S' + season + ' E' + episode + epTitle + ' | ' + meta.name;
    } else {
      line1 += meta.name + (meta.year ? ' (' + meta.year + ')' : '');
    }
    
    // Specs en ligne
    var specs = [
      '📺 ' + quality,
      langInfo.icon + ' ' + langInfo.label,
      '🎞️ ' + format
    ];
    
    var finalDuration = (epInfo && epInfo.duration) ? epInfo.duration : meta.duration;
    if (finalDuration) {
      specs.push('⏱️ ' + finalDuration);
    }
    
    results.push({
      name: 'Nakastream - ' + quality,
      title: line1 + '\n' + specs.join(' | '),
      url: streamUrl,
      quality: quality,
      lang: langInfo.label,
      format: format.toLowerCase(),
      headers: {
        'User-Agent': NAKASTREAM_UA,
        'Referer': endpoint.referer,
        'Origin': endpoint.base
      }
    });
  }
  
  // Si aucune source trouvée mais qu'on a des infos audio
  if (results.length === 0 && contentInfo.audioLanguages && contentInfo.audioLanguages.length > 0) {
    console.log('[Nakastream] Pas de sources directes, audio disponible:', contentInfo.audioLanguages);
  }
  
  return results;
}

// ─── Point d'entrée principal ────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[Nakastream] START tmdbId=' + tmdbId + ' type=' + mediaType + ' S' + season + 'E' + episode);
  
  var endpoint;
  var contentInfo;
  var meta;
  var epInfo;
  
  // Récupérer tout en parallèle
  return Promise.all([
    detectEndpoint(),
    getTmdbMetadata(tmdbId, mediaType),
    mediaType === 'tv' ? getEpisodeInfo(tmdbId, season, episode) : Promise.resolve(null)
  ])
    .then(function(results) {
      endpoint = results[0];
      meta = results[1];
      epInfo = results[2];
      
      // Récupérer l'ID interne
      return getInternalId(endpoint, tmdbId, mediaType);
    })
    .then(function(result) {
      console.log('[Nakastream] Internal ID:', result.internalId);
      contentInfo = result;
      
      // Récupérer les sources
      return fetchSources(endpoint, result.internalId, mediaType, season, episode);
    })
    .then(function(sourcesData) {
      // Normaliser avec l'UI
      var sources = normalizeSources(
        endpoint,
        sourcesData,
        contentInfo,
        meta,
        mediaType === 'tv' ? season : null,
        mediaType === 'tv' ? episode : null,
        epInfo
      );
      
      console.log('[Nakastream] ' + sources.length + ' sources trouvées');
      return sources;
    })
    .catch(function(err) {
      console.error('[Nakastream] Erreur:', err.message || err);
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
// DOCUMENTATION API NAKASTREAM
// =============================================================
// 
// DOMAINE DYNAMIQUE :
// - Récupéré depuis: https://raw.githubusercontent.com/iokza/NoAds4Website/refs/heads/main/domains.json
// - Clé: "nks" (ex: "tv" → nakastream.tv)
// - Fallback: nakastream.tv
// 
// ENDPOINTS :
// 
// 1. GET /api/v1/browse/by-tmdb/{type}/{tmdbId}
//    → Retourne { id, tmdbId, title, audioLanguages, ... }
// 
// 2. GET /api/v1/streaming/sources/{internalId}?type={type}
//    → Pour séries: &season=X&episode=Y
//    → Retourne les URLs M3U8 avec tokens
// 
// UI FORMATÉE :
// - 🎬 Titre du contenu (année)
// - 📺 Qualité (720p, 1080p, 4K)
// - 🇫🇷 VF / 🔡 VOSTFR / 🌍 MULTI / 🇬🇧 VO
// - 🎞️ Format (M3U8, MP4)
// - ⏱️ Durée
// 
// =============================================================
