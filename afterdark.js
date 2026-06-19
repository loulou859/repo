// =============================================================
// Provider : 4AfterDark (VF/VOSTFR/MULTI)
// Version : 2.0.0
// 
// API :
// - Sources : GET /api/staging-20260420-yuna-hipaa-86nnorn0/sources
//   Params: tmdbId, type, imdbId, title, releaseYear, originalTitle
//   Response: NDJSON avec providers (afroditi, iris, thais, hera, etc.)
// 
// Domaine dynamique via domains.json (clé "aftdrk")
// Fallback: 4afterdark.mom
// =============================================================

var DOMAINS_URL = 'https://raw.githubusercontent.com/iokza/NoAds4Website/refs/heads/main/domains.json';
var AFTERDARK_DOMAIN = '4afterdark.mom'; // fallback
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
      if (!tld) throw new Error('Clé "aftdrk" absente du domains.json');
      AFTERDARK_DOMAIN = '4afterdark.' + tld;
      console.log('[4AfterDark] Domaine récupéré:', AFTERDARK_DOMAIN);
      _cachedEndpoint = buildEndpoint(AFTERDARK_DOMAIN);
      return _cachedEndpoint;
    })
    .catch(function(err) {
      console.warn('[4AfterDark] domains.json échoué:', err.message, '— fallback 4afterdark.mom');
      _cachedEndpoint = buildEndpoint('4afterdark.mom');
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

// ─── TMDB avec external_ids ──────────────────────────────────

function getTmdbDataWithExternals(tmdbId, mediaType) {
  var type = mediaType === 'tv' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + type + '/' + tmdbId + 
            '?api_key=' + TMDB_KEY + 
            '&language=fr-FR&append_to_response=external_ids,seasons';
  
  return fetch(url)
    .then(function(res) { 
      if (!res.ok) throw new Error('TMDB HTTP ' + res.status);
      return res.json(); 
    })
    .then(function(data) {
      var releaseDate = data.release_date || data.first_air_date || '';
      return {
        tmdbId: tmdbId,
        imdbId: (data.external_ids && data.external_ids.imdb_id) || data.imdb_id || '',
        title: data.title || data.name || '',
        originalTitle: data.original_title || data.original_name || '',
        year: releaseDate.split('-')[0],
        runtime: data.runtime ? data.runtime + ' min' : '',
        numberOfSeasons: data.number_of_seasons
      };
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

// ─── Appel API Sources ───────────────────────────────────────

function fetchSources(endpoint, tmdbData, mediaType, season, episode) {
  var params = new URLSearchParams();
  params.set('tmdbId', tmdbData.tmdbId);
  params.set('type', mediaType === 'tv' ? 'tv' : 'movie');
  
  if (tmdbData.imdbId) {
    params.set('imdbId', tmdbData.imdbId);
  }
  if (tmdbData.title) {
    params.set('title', tmdbData.title);
  }
  if (tmdbData.year) {
    params.set('releaseYear', tmdbData.year);
  }
  if (tmdbData.originalTitle) {
    params.set('originalTitle', tmdbData.originalTitle);
  }
  
  // Pour les séries
  if (mediaType === 'tv' && season && episode) {
    params.set('season', season);
    params.set('episode', episode);
  }
  
  var url = endpoint.api + '?' + params.toString();
  console.log('[4AfterDark] Fetching sources:', url.substring(0, 100) + '...');
  
  return fetch(url, {
    method: 'GET',
    headers: getHeaders(endpoint)
  })
    .then(function(res) {
      if (!res.ok) throw new Error('Sources HTTP ' + res.status);
      return res.text();
    })
    .then(function(text) {
      console.log('[4AfterDark] Response length:', text.length);
      return parseNdjson(text);
    });
}

// ─── Parser NDJSON ───────────────────────────────────────────

function parseNdjson(text) {
  var lines = text.trim().split('\n');
  var results = [];
  
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    
    try {
      var obj = JSON.parse(line);
      results.push(obj);
    } catch (e) {
      console.warn('[4AfterDark] Failed to parse line:', line.substring(0, 50));
    }
  }
  
  return results;
}

// ─── Helpers de formatage ────────────────────────────────────

function parseLangInfo(lang) {
  if (!lang) return { icon: '🌍', label: 'MULTI' };
  
  var l = String(lang).toUpperCase();
  
  if (l.indexOf('VOSTFR') !== -1 || l.indexOf('VOST') !== -1) {
    return { icon: '🔡', label: 'VOSTFR' };
  }
  if (l.indexOf('VF') !== -1 || l.indexOf('FRENCH') !== -1 || l === 'FR') {
    return { icon: '🇫🇷', label: 'VF' };
  }
  if (l.indexOf('MULTI') !== -1) {
    return { icon: '🌍', label: 'MULTI' };
  }
  if (l.indexOf('VO') !== -1 || l.indexOf('EN') !== -1 || l === 'ENGLISH') {
    return { icon: '🇬🇧', label: 'VO' };
  }
  
  return { icon: '🌍', label: l || 'MULTI' };
}

function parseQuality(quality) {
  if (!quality) return 'HD';
  var q = String(quality).toUpperCase();
  if (q.indexOf('4K') !== -1 || q.indexOf('2160') !== -1) return '4K';
  if (q.indexOf('1080') !== -1 || q === 'FHD') return '1080p';
  if (q === 'HD') return '720p';
  if (q === 'SD' || q.indexOf('480') !== -1) return '480p';
  if (q === 'UNKNOWN') return 'HD';
  return q || 'HD';
}

function parseType(type) {
  if (!type) return 'm3u8';
  var t = String(type).toLowerCase();
  if (t === 'hls' || t === 'm3u8') return 'm3u8';
  if (t === 'mp4') return 'mp4';
  if (t === 'embed') return 'embed';
  return t;
}

function getServicePriority(service, proxied, type) {
  // Priorité : proxied HLS/MP4 > direct HLS/MP4 > embed
  var score = 0;
  
  // Type bonus
  if (type === 'hls' || type === 'mp4') score += 100;
  else if (type === 'embed') score += 10;
  
  // Proxied bonus (déjà résolu, pas besoin de parser)
  if (proxied) score += 50;
  
  // Service quality bonus
  var goodServices = ['thais', 'afroditi', 'vidara', 'vidzy'];
  var mediumServices = ['vidsonic', 'lulustream'];
  var lowServices = ['uqload', 'vidmoly', 'sharecloudy'];
  
  if (goodServices.indexOf(service) !== -1) score += 30;
  else if (mediumServices.indexOf(service) !== -1) score += 20;
  else if (lowServices.indexOf(service) !== -1) score += 10;
  
  return score;
}

// ─── Normalisation avec UI formatée ──────────────────────────

function normalizeSources(ndjsonData, tmdbData, mediaType, season, episode, epInfo) {
  var results = [];
  
  // Parcourir chaque provider (afroditi, iris, thais, hera, etc.)
  for (var p = 0; p < ndjsonData.length; p++) {
    var providerData = ndjsonData[p];
    var providerId = providerData.id || 'unknown';
    var items = providerData.items || [];
    
    console.log('[4AfterDark] Provider', providerId, ':', items.length, 'items');
    
    // Parcourir les items de ce provider
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      
      var streamUrl = item.url;
      if (!streamUrl) continue;
      
      var itemType = parseType(item.type);
      var service = item.service || providerId;
      var proxied = item.proxied === true;
      
      // Skip les embeds non proxiés (difficiles à résoudre)
      if (itemType === 'embed' && !proxied) {
        continue;
      }
      
      // Skip unknown non proxié
      if (item.quality === 'unknown' && !proxied) {
        continue;
      }
      
      // Skip qualités inférieures à 720p (sd, 480p, 360p)
      var rawQuality = String(item.quality || '').toLowerCase();
      if (rawQuality === 'sd' || rawQuality === '480p' || rawQuality === '360p' || rawQuality === '240p') {
        continue;
      }
      
      var quality = parseQuality(item.quality);
      var langInfo = parseLangInfo(item.language);
      var providerName = item.provider || providerId;
      var format = itemType === 'embed' ? 'embed' : itemType.toUpperCase();
      
      // Calculer la priorité pour le tri
      var priority = getServicePriority(service, proxied, itemType);
      
      // ─── Construction du titre formaté ───────────────────────
      var line1 = '🎬 ';
      if (mediaType === 'tv' && season && episode) {
        var epTitle = epInfo && epInfo.name ? ' - ' + epInfo.name : '';
        line1 += 'S' + season + ' E' + episode + epTitle + ' | ' + tmdbData.title;
      } else {
        line1 += tmdbData.title + (tmdbData.year ? ' (' + tmdbData.year + ')' : '');
      }
      
      var specs = [
        '📺 ' + quality,
        langInfo.icon + ' ' + langInfo.label,
        '🎞️ ' + format
      ];
      
      var duration = epInfo && epInfo.duration ? epInfo.duration : tmdbData.runtime;
      if (duration) {
        specs.push('⏱️ ' + duration);
      }
      
      // Ajouter le provider/service
      specs.push('📡 ' + providerName);
      
      // Indicateur proxied
      if (proxied) {
        specs.push('🔒');
      }
      
      results.push({
        name: '4AfterDark - ' + quality + ' ' + langInfo.label,
        title: line1 + '\n' + specs.join(' | '),
        url: streamUrl,
        quality: quality,
        lang: langInfo.label,
        format: itemType,
        priority: priority,
        proxied: proxied,
        headers: {
          'User-Agent': AFTERDARK_UA,
          'Referer': 'https://' + AFTERDARK_DOMAIN + '/'
        }
      });
    }
  }
  
  // Trier par priorité (meilleurs en premier)
  results.sort(function(a, b) {
    return (b.priority || 0) - (a.priority || 0);
  });
  
  // Limiter à 15 sources max
  if (results.length > 15) {
    results = results.slice(0, 15);
  }
  
  return results;
}

// ─── Point d'entrée principal ────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[4AfterDark] START tmdbId=' + tmdbId + ' type=' + mediaType + ' S' + season + 'E' + episode);
  
  var endpoint;
  var tmdbData;
  var epInfo;
  
  return Promise.all([
    detectEndpoint(),
    getTmdbDataWithExternals(tmdbId, mediaType),
    mediaType === 'tv' ? getEpisodeInfo(tmdbId, season, episode) : Promise.resolve(null)
  ])
    .then(function(results) {
      endpoint = results[0];
      tmdbData = results[1];
      epInfo = results[2];
      
      console.log('[4AfterDark] TMDB - title:', tmdbData.title, '| imdb:', tmdbData.imdbId);
      
      return fetchSources(endpoint, tmdbData, mediaType, season, episode);
    })
    .then(function(ndjsonData) {
      console.log('[4AfterDark] Got', ndjsonData.length, 'providers from API');
      
      var sources = normalizeSources(ndjsonData, tmdbData, mediaType, season, episode, epInfo);
      console.log('[4AfterDark]', sources.length, 'sources normalisées');
      
      return sources;
    })
    .catch(function(err) {
      console.error('[4AfterDark] Erreur:', err.message || err);
      return [];
    });
}

// ─── Export ──────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
