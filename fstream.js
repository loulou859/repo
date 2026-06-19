// =============================================================
// Provider : FStream (VF/VOSTFR/VFQ français)
// Version : 2.0.0
// 
// API :
// - Recherche : POST /engine/ajax/search.php (query, page)
// - Sources : GET /engine/ajax/film_api.php?id={internalId}
// 
// UI formatée avec émojis
// =============================================================

var FSTREAM_DOMAIN = 'fs15.lol'; // Domaine actuel - peut changer
var FSTREAM_BASE = 'https://' + FSTREAM_DOMAIN;
var FSTREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';

// ─── Headers ─────────────────────────────────────────────────

function getHeaders() {
  return {
    'User-Agent': FSTREAM_UA,
    'Referer': FSTREAM_BASE + '/',
    'Origin': FSTREAM_BASE,
    'Accept': '*/*',
    'X-Requested-With': 'XMLHttpRequest'
  };
}

// ─── TMDB Helpers ────────────────────────────────────────────

function getTmdbMetadata(tmdbId, type) {
  var url = 'https://api.themoviedb.org/3/' + (type === 'tv' ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=fr-FR';
  
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      return {
        name: data.title || data.name || 'FStream',
        year: (data.release_date || data.first_air_date || '').split('-')[0],
        duration: data.runtime ? data.runtime + ' min' : '',
        originalTitle: data.original_title || data.original_name
      };
    })
    .catch(function() { 
      return { name: 'FStream', year: '', duration: '', originalTitle: '' }; 
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

// ─── Recherche FStream ───────────────────────────────────────

function searchFStream(title) {
  var url = FSTREAM_BASE + '/engine/ajax/search.php';
  
  console.log('[FStream] Recherche:', title);
  
  return fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': FSTREAM_UA,
      'Referer': FSTREAM_BASE + '/',
      'Origin': FSTREAM_BASE,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '*/*',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: 'query=' + encodeURIComponent(title) + '&page=1'
  })
    .then(function(res) {
      if (!res.ok) throw new Error('Search HTTP ' + res.status);
      return res.text();
    })
    .then(function(html) {
      console.log('[FStream] Search response length:', html.length);
      
      // Parser le HTML pour trouver l'ID
      // Format: onclick="location.href='/15124481-marty-supreme.html'"
      var matches = html.match(/location\.href='\/(\d+)-[^']*\.html'/gi);
      
      if (!matches || matches.length === 0) {
        // Essayer un autre pattern
        matches = html.match(/href='\/(\d+)-[^']*\.html'/gi);
      }
      
      if (!matches || matches.length === 0) {
        // Essayer encore
        matches = html.match(/\/(\d+)-[^'"]*\.html/gi);
      }
      
      if (!matches || matches.length === 0) {
        throw new Error('Aucun résultat pour: ' + title);
      }
      
      // Extraire le premier ID
      var idMatch = matches[0].match(/\/(\d+)-/);
      if (idMatch) {
        console.log('[FStream] Found ID:', idMatch[1]);
        return idMatch[1];
      }
      
      throw new Error('ID non trouvé dans les résultats');
    });
}

// ─── Récupération des sources ────────────────────────────────

function fetchSources(internalId) {
  var url = FSTREAM_BASE + '/engine/ajax/film_api.php?id=' + internalId;
  
  console.log('[FStream] Getting sources:', url);
  
  return fetch(url, {
    method: 'GET',
    headers: getHeaders()
  })
    .then(function(res) {
      if (!res.ok) throw new Error('API HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      console.log('[FStream] Sources response received');
      return data;
    });
}

// ─── Résolution des embeds vers M3U8/MP4 ─────────────────────

function resolveEmbed(embedUrl) {
  console.log('[FStream] Resolving embed:', embedUrl.substring(0, 60) + '...');
  
  return fetch(embedUrl, {
    method: 'GET',
    headers: {
      'User-Agent': FSTREAM_UA,
      'Referer': FSTREAM_BASE + '/'
    }
  })
    .then(function(res) {
      if (!res.ok) return null;
      return res.text();
    })
    .then(function(html) {
      if (!html) return null;
      
      // Patterns pour trouver les URLs m3u8/mp4
      var patterns = [
        /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
        /source\s+src=["']([^"']+\.m3u8[^"']*)["']/i,
        /sources\s*:\s*\[\s*\{\s*["']?file["']?\s*:\s*["']([^"']+)["']/i,
        /["']([^"']*master\.m3u8[^"']*)["']/i,
        /["']([^"']+\.m3u8(?:\?[^"']*)?)["']/i,
        /file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
        /["']([^"']+\.mp4(?:\?[^"']*)?)["']/i
      ];
      
      for (var i = 0; i < patterns.length; i++) {
        var match = html.match(patterns[i]);
        if (match) {
          var url = match[1];
          if (url.indexOf('//') === 0) url = 'https:' + url;
          if (url.indexOf('http') === 0) {
            console.log('[FStream] Resolved:', url.substring(0, 60) + '...');
            return url;
          }
        }
      }
      
      return null;
    })
    .catch(function() { return null; });
}

// ─── Helpers de formatage ────────────────────────────────────

function parseLangInfo(langKey) {
  var key = String(langKey).toLowerCase();
  
  if (key === 'vff' || key === 'vf') {
    return { icon: '🇫🇷', label: 'VF', priority: 1 };
  }
  if (key === 'vfq') {
    return { icon: '🇨🇦', label: 'VFQ', priority: 2 };
  }
  if (key === 'vostfr' || key === 'vost') {
    return { icon: '🔡', label: 'VOSTFR', priority: 3 };
  }
  if (key === 'vo' || key === 'en') {
    return { icon: '🇬🇧', label: 'VO', priority: 4 };
  }
  if (key === 'default') {
    return { icon: '🌍', label: 'MULTI', priority: 5 };
  }
  
  return { icon: '🌍', label: key.toUpperCase(), priority: 10 };
}

function getProviderInfo(url) {
  if (!url) return { name: 'FStream', quality: 'HD' };
  var urlLower = url.toLowerCase();
  
  if (urlLower.indexOf('fsvid') !== -1) return { name: 'FSVid', quality: '1080p' };
  if (urlLower.indexOf('vidzy') !== -1) return { name: 'Vidzy', quality: '1080p' };
  if (urlLower.indexOf('uqload') !== -1) return { name: 'Uqload', quality: '720p' };
  if (urlLower.indexOf('voe') !== -1) return { name: 'Voe', quality: '1080p' };
  if (urlLower.indexOf('dood') !== -1) return { name: 'Doodstream', quality: '720p' };
  if (urlLower.indexOf('filmoon') !== -1) return { name: 'Filmoon', quality: '720p' };
  
  return { name: 'FStream', quality: 'HD' };
}

function detectFormat(url) {
  if (!url) return 'mp4';
  if (url.indexOf('.m3u8') !== -1) return 'm3u8';
  if (url.indexOf('.mp4') !== -1) return 'mp4';
  return 'm3u8';
}

// ─── Normalisation avec UI formatée ──────────────────────────

function extractSources(apiData, meta, season, episode, epInfo) {
  var results = [];
  var players = apiData.players || {};
  
  // Providers prioritaires (résolubles)
  var priorityProviders = ['premium', 'vidzy'];
  // Providers à skip (embeds difficiles)
  var skipProviders = ['dood', 'voe', 'filmoon', 'uqload'];
  
  // Parcourir les providers prioritaires d'abord
  var allProviders = Object.keys(players);
  allProviders.sort(function(a, b) {
    var aIdx = priorityProviders.indexOf(a.toLowerCase());
    var bIdx = priorityProviders.indexOf(b.toLowerCase());
    if (aIdx === -1) aIdx = 100;
    if (bIdx === -1) bIdx = 100;
    return aIdx - bIdx;
  });
  
  for (var p = 0; p < allProviders.length; p++) {
    var providerKey = allProviders[p];
    
    // Skip certains providers
    if (skipProviders.indexOf(providerKey.toLowerCase()) !== -1) {
      continue;
    }
    
    var provider = players[providerKey];
    if (!provider || typeof provider !== 'object') continue;
    
    // Parcourir les langues
    var langKeys = Object.keys(provider);
    
    for (var l = 0; l < langKeys.length; l++) {
      var langKey = langKeys[l];
      var embedUrl = provider[langKey];
      
      if (!embedUrl || typeof embedUrl !== 'string') continue;
      if (langKey === 'default' && langKeys.length > 1) continue; // Skip default si autres langues
      
      var langInfo = parseLangInfo(langKey);
      var providerInfo = getProviderInfo(embedUrl);
      
      // ─── Construction du titre formaté ───────────────────
      var line1 = '🎬 ';
      if (season && episode) {
        var epTitle = epInfo && epInfo.name ? ' - ' + epInfo.name : '';
        line1 += 'S' + season + ' E' + episode + epTitle + ' | ' + meta.name;
      } else {
        line1 += meta.name + (meta.year ? ' (' + meta.year + ')' : '');
      }
      
      var specs = [
        '📺 ' + providerInfo.quality,
        langInfo.icon + ' ' + langInfo.label,
        '📡 ' + providerInfo.name
      ];
      
      var duration = epInfo && epInfo.duration ? epInfo.duration : meta.duration;
      if (duration) {
        specs.push('⏱️ ' + duration);
      }
      
      results.push({
        name: 'FStream - ' + langInfo.label + ' ' + providerInfo.quality,
        title: line1 + '\n' + specs.join(' | '),
        embedUrl: embedUrl,
        url: embedUrl, // Sera remplacé après résolution
        quality: providerInfo.quality,
        lang: langInfo.label,
        format: 'embed',
        priority: langInfo.priority,
        providerName: providerInfo.name,
        headers: {
          'User-Agent': FSTREAM_UA,
          'Referer': FSTREAM_BASE + '/'
        }
      });
    }
  }
  
  // Trier par priorité de langue
  results.sort(function(a, b) {
    return (a.priority || 10) - (b.priority || 10);
  });
  
  return results;
}

// ─── Résolution des embeds en parallèle ──────────────────────

function resolveAllEmbeds(sources) {
  // Ne résoudre que les providers supportés
  var supportedHosts = ['fsvid', 'vidzy'];
  
  var toResolve = sources.filter(function(s) {
    var url = (s.embedUrl || s.url || '').toLowerCase();
    return supportedHosts.some(function(host) {
      return url.indexOf(host) !== -1;
    });
  });
  
  if (toResolve.length === 0) {
    console.log('[FStream] Aucune source résoluble');
    return Promise.resolve([]);
  }
  
  console.log('[FStream] Résolution de', toResolve.length, 'embeds...');
  
  var promises = toResolve.map(function(source) {
    return resolveEmbed(source.embedUrl)
      .then(function(resolvedUrl) {
        if (resolvedUrl) {
          source.url = resolvedUrl;
          source.format = detectFormat(resolvedUrl);
          delete source.embedUrl;
          return source;
        }
        return null;
      })
      .catch(function() { return null; });
  });
  
  return Promise.all(promises)
    .then(function(resolved) {
      var valid = resolved.filter(function(s) { return s !== null; });
      console.log('[FStream]', valid.length, '/', toResolve.length, 'embeds résolus');
      return valid;
    });
}

// ─── Point d'entrée principal ────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[FStream] START tmdbId=' + tmdbId + ' type=' + mediaType + ' S' + season + 'E' + episode);
  
  var meta;
  var epInfo;
  
  return Promise.all([
    getTmdbMetadata(tmdbId, mediaType),
    mediaType === 'tv' ? getEpisodeInfo(tmdbId, season, episode) : Promise.resolve(null)
  ])
    .then(function(results) {
      meta = results[0];
      epInfo = results[1];
      
      console.log('[FStream] Searching for:', meta.name);
      
      // Rechercher le film par titre français
      return searchFStream(meta.name)
        .catch(function(err) {
          console.log('[FStream] Titre FR échoué, essai titre original...');
          // Essayer avec le titre original
          if (meta.originalTitle && meta.originalTitle !== meta.name) {
            return searchFStream(meta.originalTitle);
          }
          throw err;
        });
    })
    .then(function(internalId) {
      console.log('[FStream] Found internal ID:', internalId);
      return fetchSources(internalId);
    })
    .then(function(apiData) {
      var sources = extractSources(
        apiData,
        meta,
        mediaType === 'tv' ? season : null,
        mediaType === 'tv' ? episode : null,
        epInfo
      );
      
      console.log('[FStream]', sources.length, 'sources extraites');
      
      // Résoudre les embeds
      return resolveAllEmbeds(sources);
    })
    .then(function(resolvedSources) {
      console.log('[FStream]', resolvedSources.length, 'sources finales');
      return resolvedSources;
    })
    .catch(function(err) {
      console.error('[FStream] Erreur:', err.message || err);
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
// DOCUMENTATION API FSTREAM
// =============================================================
// 
// DOMAINE : fs15.lol (peut changer, ex: fs14, fs16...)
// 
// ENDPOINTS :
// 
// 1. Recherche :
//    POST /engine/ajax/search.php
//    Content-Type: application/x-www-form-urlencoded
//    Body: query={titre}&page=1
//    
//    Response HTML:
//    <div class='search-item' onclick="location.href='/15124481-marty-supreme.html'">
//      <img src='...' alt='Marty Supreme'>
//      <div class='search-title'>Marty Supreme (2025)</div>
//    </div>
// 
// 2. Sources film :
//    GET /engine/ajax/film_api.php?id={internalId}
//    
//    Response JSON:
//    {
//      players: {
//        premium: { vff, vfq, vostfr, default },
//        vidzy: { ... },
//        uqload: { ... },
//        ...
//      },
//      meta: { affiche, tagz: "f-{tmdbId}", ... }
//    }
// 
// PROVIDERS :
// - premium (fsvid.lol) → 1080p ✅ Résoluble
// - vidzy (vidzy.org) → 1080p ✅ Résoluble
// - uqload → 720p ❌ Skip
// - voe → 1080p ❌ Skip
// - dood → 720p ❌ Skip
// - filmoon → 720p ❌ Skip
// 
// LANGUES :
// - vff = VF France 🇫🇷
// - vfq = VF Québec 🇨🇦
// - vostfr = VOSTFR 🔡
// - default = Multi 🌍
// 
// =============================================================
