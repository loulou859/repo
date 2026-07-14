// =============================================================
// Provider : Nakastream (VF/VO français)
// Version : 3.0.0
// 
// API :
// 1. /api/v1/browse/search?q={title} → Trouver le contenu par titre TMDB
// 2. /api/v1/streaming/sources/{internalId}?type={type} → Sources
// 
// Auth : Bearer token requis
// Domaine dynamique via domains.json (clé "naks")
// =============================================================

var DOMAINS_URL = 'https://raw.githubusercontent.com/iokza/NoAds4Website/refs/heads/main/domains.json';
var NAKASTREAM_DOMAIN = 'nakastream.tv'; // fallback
var NAKASTREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
var TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';

// ─── Token Bearer (récupéré depuis le site) ──────────────────
// Ce token est nécessaire pour authentifier les requêtes API
var BEARER_TOKEN = 'oat_MzEyMTAw.RExVdlMtTExqLUVTMVVsZVYtLUw3Vlp4X25zWmhycTFjcXB2OHdaVzE4MjAzOTkzNDA';

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
      // Essayer plusieurs clés possibles
      var tld = data['naks'] || data['nks'] || data['nakastream'];
      if (!tld) throw new Error('Clé Nakastream absente du domains.json');
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

// ─── Headers avec Auth ────────────────────────────────────────

function getHeaders(endpoint, withAuth) {
  var headers = {
    'User-Agent': NAKASTREAM_UA,
    'Referer': endpoint.referer,
    'Origin': endpoint.base,
    'Accept': 'application/json',
    'Accept-Language': 'fr-FR,fr;q=0.8'
  };
  
  if (withAuth !== false) {
    headers['Authorization'] = 'Bearer ' + BEARER_TOKEN;
  }
  
  return headers;
}

// ─── TMDB Helpers ─────────────────────────────────────────────

function getTmdbMetadata(tmdbId, type) {
  var url = 'https://api.themoviedb.org/3/' + (type === 'tv' ? 'tv' : 'movie') + '/' + tmdbId 
          + '?api_key=' + TMDB_KEY + '&language=fr-FR';
  
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
      
      return { 
        name: name, 
        year: year, 
        duration: duration,
        // Garder le titre original pour la recherche
        originalTitle: data.original_title || data.original_name || name
      };
    })
    .catch(function() { 
      return { name: 'Nakastream', year: '', duration: '', originalTitle: '' }; 
    });
}

function getEpisodeInfo(tmdbId, season, episode) {
  if (!tmdbId || !season || !episode) return Promise.resolve(null);
  
  var url = 'https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + season + '/episode/' + episode 
          + '?api_key=' + TMDB_KEY + '&language=fr-FR';
  
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

// ─── Étape 1 : Rechercher via /browse/search puis filtrer par tmdbId ──

function getInternalId(endpoint, tmdbId, mediaType, meta) {
  // On utilise le titre français ou anglais pour la recherche
  var searchQuery = encodeURIComponent(meta.name || meta.originalTitle || '');
  var url = endpoint.api + '/browse/search?q=' + searchQuery;
  
  console.log('[Nakastream] Searching:', url);
  
  return fetch(url, {
    method: 'GET',
    headers: getHeaders(endpoint)
  })
    .then(function(res) {
      if (!res.ok) {
        throw new Error('Search HTTP ' + res.status);
      }
      return res.json();
    })
    .then(function(response) {
      // La réponse est { data: [...] }
      var items = response.data || response.results || response || [];
      
      if (!Array.isArray(items)) {
        throw new Error('Format de réponse search inattendu');
      }
      
      console.log('[Nakastream] Search returned ' + items.length + ' results');
      
      // Chercher par tmdbId exact
      var match = null;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (String(item.tmdbId) === String(tmdbId)) {
          match = item;
          break;
        }
      }
      
      // Si pas de match par tmdbId, essayer avec le titre original
      if (!match && meta.originalTitle) {
        var searchQueryAlt = encodeURIComponent(meta.originalTitle);
        console.log('[Nakastream] Retry search with original title:', meta.originalTitle);
        return fetch(endpoint.api + '/browse/search?q=' + searchQueryAlt, {
          method: 'GET',
          headers: getHeaders(endpoint)
        })
          .then(function(res2) { return res2.json(); })
          .then(function(response2) {
            var items2 = response2.data || response2.results || response2 || [];
            for (var j = 0; j < items2.length; j++) {
              if (String(items2[j].tmdbId) === String(tmdbId)) {
                return extractContentInfo(items2[j]);
              }
            }
            // Dernier recours : premier résultat si un seul
            if (items2.length === 1) {
              console.log('[Nakastream] Using single result as fallback');
              return extractContentInfo(items2[0]);
            }
            throw new Error('Contenu TMDB ID ' + tmdbId + ' non trouvé sur Nakastream');
          });
      }
      
      if (!match) {
        // Dernier recours : premier résultat si un seul
        if (items.length === 1) {
          console.log('[Nakastream] Using single result as fallback');
          return extractContentInfo(items[0]);
        }
        throw new Error('Contenu TMDB ID ' + tmdbId + ' non trouvé sur Nakastream');
      }
      
      return extractContentInfo(match);
    });
}

function extractContentInfo(item) {
  console.log('[Nakastream] Found: id=' + item.id + ', title=' + item.title + ', tmdbId=' + item.tmdbId);
  return {
    internalId: item.id,
    title: item.title || item.originalTitle,
    quality: item.quality,
    audioLanguages: item.audioLanguages || [],
    subtitleLanguages: item.subtitleLanguages || [],
    runtime: item.runtime || null
  };
}

// ─── Étape 2 : Récupérer les sources ─────────────────────────

function fetchSources(endpoint, internalId, mediaType, season, episode) {
  var type = mediaType === 'tv' ? 'tv' : 'movie';
  var url = endpoint.api + '/streaming/sources/' + internalId + '?type=' + type;
  
  if (mediaType === 'tv' && season && episode) {
    url += '&season=' + season + '&episode=' + episode;
  }
  
  // Referer spécifique comme dans le navigateur
  var referer = endpoint.base + '/player?id=' + internalId + '&type=' + type;
  
  console.log('[Nakastream] Getting sources:', url);
  
  var headers = getHeaders(endpoint);
  headers['Referer'] = referer;
  
  return fetch(url, {
    method: 'GET',
    headers: headers
  })
    .then(function(res) {
      if (!res.ok) throw new Error('Sources HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      console.log('[Nakastream] Sources received:', JSON.stringify(data).substring(0, 200));
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
  if (l === 'FR' || l === 'FRE' || l === 'FRANÇAIS' || l.indexOf('FRENCH') !== -1 || l.indexOf('VF') !== -1) {
    return { icon: '🇫🇷', label: 'VF' };
  }
  if (l.indexOf('MULTI') !== -1) {
    return { icon: '🌍', label: 'MULTI' };
  }
  if (l === 'EN' || l === 'ENG' || l === 'ENGLISH' || l.indexOf('VO') !== -1) {
    return { icon: '🇬🇧', label: 'VO' };
  }
  
  return { icon: '🌍', label: l };
}

function detectFormat(url) {
  if (!url) return 'mp4';
  var urlLower = url.toLowerCase().split('?')[0]; // ignorer les query params
  if (urlLower.indexOf('.m3u8') !== -1) return 'm3u8';
  if (urlLower.indexOf('.mp4') !== -1) return 'mp4';
  if (urlLower.indexOf('.mkv') !== -1) return 'mkv';
  return 'm3u8'; // défaut HLS
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

// ─── Détection de la langue depuis les audioTracks ──────────

function detectAudioLang(source) {
  // Regarder les audioTracks
  if (source.audioTracks && source.audioTracks.length > 0) {
    var hasVF = false;
    var hasVO = false;
    
    for (var i = 0; i < source.audioTracks.length; i++) {
      var track = source.audioTracks[i];
      var lang = (track.lang || track.language || '').toLowerCase();
      if (lang === 'fr' || lang === 'fre' || lang === 'français') {
        hasVF = true;
      }
      if (lang === 'en' || lang === 'eng' || lang === 'english') {
        hasVO = true;
      }
    }
    
    if (hasVF && hasVO) return 'MULTI';
    if (hasVF) return 'VF';
    if (hasVO) return 'VO';
  }
  
  // Fallback sur le champ language
  if (source.language) return source.language;
  
  return null;
}

// ─── Étape 3 : Normaliser les sources ───────────────────────

function normalizeSources(endpoint, sourcesData, contentInfo, meta, season, episode, epInfo) {
  var results = [];
  
  // Extraire le tableau de sources
  var sources = [];
  
  if (Array.isArray(sourcesData.sources)) {
    sources = sourcesData.sources;
  } else if (Array.isArray(sourcesData.streams)) {
    sources = sourcesData.streams;
  } else if (Array.isArray(sourcesData.data)) {
    sources = sourcesData.data;
  } else if (Array.isArray(sourcesData)) {
    sources = sourcesData;
  } else if (sourcesData.url || sourcesData.streamUrl) {
    sources = [sourcesData];
  }
  
  console.log('[Nakastream] Processing ' + sources.length + ' sources');
  
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    
    // Récupérer l'URL du stream
    var streamUrl = src.url || src.stream_url || src.streamUrl || src.file || src.m3u8 || src.link;
    if (!streamUrl) continue;
    
    // Rendre l'URL absolue si relative
    if (streamUrl.charAt(0) === '/') {
      streamUrl = endpoint.base + streamUrl;
    }
    
    // Qualité
    var quality = parseQuality(
      src.maxQuality || src.quality || src.resolution || src.label || contentInfo.quality
    );
    
    // Langue (depuis audioTracks en priorité)
    var detectedLang = detectAudioLang(src);
    var langInfo = parseLangInfo(detectedLang || src.language || src.lang || src.audio);
    
    // Format
    var format = detectFormat(streamUrl).toUpperCase();
    
    // ─── Titre formaté ────────────────────────────────────
    var titleLine = '🎬 ';
    if (season && episode) {
      var epTitle = epInfo && epInfo.name ? ' - ' + epInfo.name : '';
      titleLine += 'S' + String(season).padStart ? 
        'S' + season + 'E' + episode + epTitle : 
        'S' + season + 'E' + episode + epTitle;
      titleLine += ' | ' + meta.name;
    } else {
      titleLine += meta.name + (meta.year ? ' (' + meta.year + ')' : '');
    }
    
    // Specs
    var finalDuration = (epInfo && epInfo.duration) 
      ? epInfo.duration 
      : (contentInfo.runtime ? contentInfo.runtime + ' min' : meta.duration);
    
    var specs = [
      '📺 ' + quality,
      langInfo.icon + ' ' + langInfo.label,
      '🎞️ ' + format
    ];
    if (finalDuration) specs.push('⏱️ ' + finalDuration);
    
    // Sous-titres disponibles
    var subsInfo = '';
    if (src.subtitles && src.subtitles.length > 0) {
      var subLabels = src.subtitles.map(function(s) { return s.label || s.lang; });
      subsInfo = '\n💬 Sous-titres: ' + subLabels.join(', ');
    }
    
    // Headers pour le stream
    var streamHeaders = {
      'User-Agent': NAKASTREAM_UA,
      'Referer': endpoint.base + '/player?id=' + contentInfo.internalId + '&type=' + (season ? 'tv' : 'movie'),
      'Origin': endpoint.base
    };
    
    results.push({
      name: 'Nakastream - ' + quality + ' ' + langInfo.label,
      title: titleLine + '\n' + specs.join(' | ') + subsInfo,
      url: streamUrl,
      quality: quality,
      lang: langInfo.label,
      format: format.toLowerCase(),
      subtitles: src.subtitles ? src.subtitles.map(function(sub) {
        return {
          lang: sub.lang,
          label: sub.label,
          url: sub.url && sub.url.charAt(0) === '/' ? endpoint.base + sub.url : sub.url,
          default: sub.default || false
        };
      }) : [],
      headers: streamHeaders
    });
  }
  
  return results;
}

// ─── Point d'entrée principal ────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[Nakastream] START tmdbId=' + tmdbId + ' type=' + mediaType + 
              (season ? ' S' + season + 'E' + episode : ''));
  
  var endpoint;
  var contentInfo;
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
      
      console.log('[Nakastream] Meta:', meta.name, meta.year);
      
      // Rechercher le contenu par titre + vérifier tmdbId
      return getInternalId(endpoint, tmdbId, mediaType, meta);
    })
    .then(function(result) {
      console.log('[Nakastream] Internal ID:', result.internalId);
      contentInfo = result;
      
      return fetchSources(endpoint, result.internalId, mediaType, season, episode);
    })
    .then(function(sourcesData) {
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
