// =============================================================
// Provider : Streamflix (VF/VOSTFR/MULTI)
// Version : 1.0.0
// 
// API :
// - Recherche : GET /api/search?q={titre}
//   Response: JSON array avec id, tmdbId, type, title, year, rating
// 
// - Sources film : GET /api/movies/{id}/video-url
//   Response: JSON avec url, isHls, playerUrl, proxyPath, directUrl
// 
// - Sources série : GET /api/series/{id}/season/{s}/episode/{e}/video-url
//   (pattern déduit de la structure)
// 
// Domaine : streamflix.mom
// =============================================================

var STREAMFLIX_DOMAIN = 'streamflix.mom';
var STREAMFLIX_BASE = 'https://' + STREAMFLIX_DOMAIN;
var STREAMFLIX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
var TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';

// ─── Headers ─────────────────────────────────────────────────

function getHeaders() {
  return {
    'User-Agent': STREAMFLIX_UA,
    'Referer': STREAMFLIX_BASE + '/',
    'Origin': STREAMFLIX_BASE,
    'Accept': '*/*'
  };
}

// ─── TMDB Helpers ────────────────────────────────────────────

function getTmdbMetadata(tmdbId, type) {
  var mediaType = type === 'tv' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + mediaType + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=fr-FR';
  
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      return {
        name: data.title || data.name || 'Streamflix',
        originalTitle: data.original_title || data.original_name || '',
        year: (data.release_date || data.first_air_date || '').split('-')[0],
        duration: data.runtime ? data.runtime + ' min' : ''
      };
    })
    .catch(function() { 
      return { name: 'Streamflix', originalTitle: '', year: '', duration: '' }; 
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

// ─── Recherche Streamflix ────────────────────────────────────

function searchStreamflix(title, tmdbId, mediaType) {
  var url = STREAMFLIX_BASE + '/api/search?q=' + encodeURIComponent(title);
  
  console.log('[Streamflix] Recherche:', title);
  
  return fetch(url, {
    method: 'GET',
    headers: getHeaders()
  })
    .then(function(res) {
      if (!res.ok) throw new Error('Search HTTP ' + res.status);
      return res.json();
    })
    .then(function(results) {
      if (!results || results.length === 0) {
        throw new Error('Aucun résultat pour: ' + title);
      }
      
      console.log('[Streamflix] ' + results.length + ' résultats trouvés');
      
      var targetType = mediaType === 'tv' ? 'série' : 'film';
      
      // 1. Match par tmdbId exact
      for (var i = 0; i < results.length; i++) {
        if (results[i].tmdbId && String(results[i].tmdbId) === String(tmdbId)) {
          console.log('[Streamflix] Match tmdbId exact:', results[i].title, '| id:', results[i].id);
          return results[i];
        }
      }
      
      // 2. Match titre exact + bon type
      var titleLower = title.toLowerCase();
      for (var i = 0; i < results.length; i++) {
        if (results[i].type === targetType && results[i].title && results[i].title.toLowerCase() === titleLower) {
          console.log('[Streamflix] Match titre exact:', results[i].title, '| id:', results[i].id);
          return results[i];
        }
      }
      
      // 3. Premier résultat du bon type
      for (var i = 0; i < results.length; i++) {
        if (results[i].type === targetType) {
          console.log('[Streamflix] Premier du bon type:', results[i].title, '| id:', results[i].id);
          return results[i];
        }
      }
      
      // 4. Fallback premier résultat
      console.log('[Streamflix] Fallback premier résultat:', results[0].title, '| id:', results[0].id);
      return results[0];
    });
}

// ─── Récupération des sources ────────────────────────────────

function fetchMovieSource(internalId) {
  var url = STREAMFLIX_BASE + '/api/movies/' + internalId + '/video-url';
  
  console.log('[Streamflix] Getting movie source:', url);
  
  return fetch(url, {
    method: 'GET',
    headers: getHeaders()
  })
    .then(function(res) {
      if (!res.ok) throw new Error('Video URL HTTP ' + res.status);
      return res.json();
    });
}

function fetchSeriesSource(internalId, season, episode) {
  // Tester plusieurs patterns d'URL possibles pour les séries
  var urls = [
    STREAMFLIX_BASE + '/api/series/' + internalId + '/season/' + season + '/episode/' + episode + '/video-url',
    STREAMFLIX_BASE + '/api/series/' + internalId + '/video-url?season=' + season + '&episode=' + episode,
    STREAMFLIX_BASE + '/api/episodes/' + internalId + '/season/' + season + '/episode/' + episode + '/video-url'
  ];
  
  console.log('[Streamflix] Getting series source, trying patterns...');
  
  function tryNext(index) {
    if (index >= urls.length) {
      return Promise.reject(new Error('Aucun endpoint série trouvé'));
    }
    
    console.log('[Streamflix] Trying:', urls[index]);
    
    return fetch(urls[index], {
      method: 'GET',
      headers: getHeaders()
    })
      .then(function(res) {
        if (!res.ok) {
          console.log('[Streamflix] Pattern ' + index + ' failed: HTTP ' + res.status);
          return tryNext(index + 1);
        }
        return res.json();
      })
      .catch(function() {
        return tryNext(index + 1);
      });
  }
  
  return tryNext(0);
}

// ─── Helpers de formatage ────────────────────────────────────

function detectFormat(url, isHls) {
  if (isHls) return 'm3u8';
  if (!url) return 'mp4';
  if (url.indexOf('.m3u8') !== -1) return 'm3u8';
  if (url.indexOf('.mp4') !== -1) return 'mp4';
  if (url.indexOf('.mkv') !== -1) return 'mkv';
  return 'mp4';
}

function detectQuality(url) {
  if (!url) return 'HD';
  var u = url.toUpperCase();
  if (u.indexOf('4K') !== -1 || u.indexOf('2160') !== -1) return '4K';
  if (u.indexOf('1080') !== -1 || u.indexOf('FHD') !== -1) return '1080p';
  if (u.indexOf('720') !== -1) return '720p';
  if (u.indexOf('480') !== -1) return '480p';
  return 'HD';
}

function detectLang(url, title) {
  if (!url && !title) return { icon: '🌍', label: 'MULTI' };
  
  var check = ((url || '') + ' ' + (title || '')).toUpperCase();
  
  if (check.indexOf('VOSTFR') !== -1) return { icon: '🔡', label: 'VOSTFR' };
  if (check.indexOf('VFF') !== -1 || check.indexOf('.VF.') !== -1 || check.indexOf('-VF-') !== -1) return { icon: '🇫🇷', label: 'VF' };
  if (check.indexOf('FRENCH') !== -1) return { icon: '🇫🇷', label: 'VF' };
  if (check.indexOf('MULTI') !== -1) return { icon: '🌍', label: 'MULTI' };
  
  // Par défaut VF car site français
  return { icon: '🇫🇷', label: 'VF' };
}

// ─── Normalisation avec UI formatée ──────────────────────────

function normalizeSource(videoData, meta, mediaType, season, episode, epInfo) {
  var results = [];
  
  // URL principale
  var streamUrl = videoData.directUrl || videoData.url || videoData.playerUrl;
  if (!streamUrl) {
    console.log('[Streamflix] Pas d\'URL de stream trouvée');
    return results;
  }
  
  var isHls = videoData.isHls === true;
  var format = detectFormat(streamUrl, isHls);
  var quality = detectQuality(streamUrl);
  var langInfo = detectLang(streamUrl, meta.name);
  
  // ─── Construction du titre formaté ───────────────────────
  var line1 = '🎬 ';
  if (mediaType === 'tv' && season && episode) {
    var epTitle = epInfo && epInfo.name ? ' - ' + epInfo.name : '';
    line1 += 'S' + season + ' E' + episode + epTitle + ' | ' + meta.name;
  } else {
    line1 += meta.name + (meta.year ? ' (' + meta.year + ')' : '');
  }
  
  var specs = [
    '📺 ' + quality,
    langInfo.icon + ' ' + langInfo.label,
    '🎞️ ' + format.toUpperCase()
  ];
  
  var duration = epInfo && epInfo.duration ? epInfo.duration : meta.duration;
  if (duration) {
    specs.push('⏱️ ' + duration);
  }
  
  specs.push('📡 Streamflix');
  
  // Source directe
  results.push({
    name: 'Streamflix - ' + quality + ' ' + langInfo.label,
    title: line1 + '\n' + specs.join(' | '),
    url: streamUrl,
    quality: quality,
    lang: langInfo.label,
    format: format,
    headers: {
      'User-Agent': STREAMFLIX_UA,
      'Referer': STREAMFLIX_BASE + '/'
    }
  });
  
  return results;
}

// ─── Point d'entrée principal ────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[Streamflix] START tmdbId=' + tmdbId + ' type=' + mediaType + ' S' + season + 'E' + episode);
  
  var meta;
  var epInfo;
  
  return Promise.all([
    getTmdbMetadata(tmdbId, mediaType),
    mediaType === 'tv' ? getEpisodeInfo(tmdbId, season, episode) : Promise.resolve(null)
  ])
    .then(function(results) {
      meta = results[0];
      epInfo = results[1];
      
      console.log('[Streamflix] Searching for:', meta.name);
      
      // Rechercher par titre français d'abord
      return searchStreamflix(meta.name, tmdbId, mediaType)
        .catch(function(err) {
          console.log('[Streamflix] Titre FR échoué, essai titre original...');
          if (meta.originalTitle && meta.originalTitle !== meta.name) {
            return searchStreamflix(meta.originalTitle, tmdbId, mediaType);
          }
          throw err;
        });
    })
    .then(function(matchedItem) {
      var internalId = matchedItem.id;
      console.log('[Streamflix] Found internal ID:', internalId, '| Title:', matchedItem.title);
      
      if (mediaType === 'tv') {
        return fetchSeriesSource(internalId, season, episode);
      } else {
        return fetchMovieSource(internalId);
      }
    })
    .then(function(videoData) {
      console.log('[Streamflix] Video data received:', JSON.stringify(videoData).substring(0, 200));
      
      var sources = normalizeSource(videoData, meta, mediaType, season, episode, epInfo);
      console.log('[Streamflix]', sources.length, 'sources finales');
      
      return sources;
    })
    .catch(function(err) {
      console.error('[Streamflix] Erreur:', err.message || err);
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
// DOCUMENTATION API STREAMFLIX
// =============================================================
// 
// DOMAINE : streamflix.mom
// 
// ENDPOINTS :
// 
// 1. Recherche :
//    GET /api/search?q={titre}
//    
//    Response JSON array:
//    [
//      {
//        "id": "2515",
//        "tmdbId": 936075,
//        "type": "film",           // ou "série"
//        "title": "Michael",
//        "image": "https://image.tmdb.org/t/p/w185/xxx.jpg",
//        "poster_path": "xxx.jpg",
//        "year": 2026,
//        "rating": 7.3
//      }
//    ]
// 
// 2. Sources film :
//    GET /api/movies/{id}/video-url
//    
//    Response JSON:
//    {
//      "url": "https://cdn.fastflux.xyz/movies/Title-Year.mp4",
//      "isHls": false,
//      "playerUrl": "https://cdn.fastflux.xyz/movies/Title-Year.mp4",
//      "proxyPath": "/api/movies/{id}/video-proxy",
//      "directUrl": "https://cdn.fastflux.xyz/movies/Title-Year.mp4"
//    }
// 
// 3. Sources série (patterns probables) :
//    GET /api/series/{id}/season/{s}/episode/{e}/video-url
//    GET /api/series/{id}/video-url?season={s}&episode={e}
// 
// CDN : cdn.fastflux.xyz
// Formats : MP4 direct, HLS possible (isHls: true)
// Proxy : disponible via proxyPath
// 
// TYPES dans la recherche :
// - "film" = movie
// - "série" = tv
// 
// =============================================================
