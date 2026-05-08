// ============================================================
// Provider Nuvio : Anime-Sama
// Fixes v7.2 :
//   - Détection domaine via anime-sama.pw (pivot officiel)
//   - Filever obligatoire avant episodes.js
//   - Fallback domaines : .tv → .si → .to
//   - Promise chains (Hermes/React Native, pas d'async/await)
// ============================================================

var UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var TMDB_KEY = '2dca580c2a14b55200e784d157207b4d';
var LANGS    = ['vf', 'vostfr'];

var _cachedBase = null;
var _cache = {};

// ─── Détection domaine actif via anime-sama.pw ───────────────

function detectAnimeSamaBase() {
  if (_cachedBase) return Promise.resolve(_cachedBase);

  // Tester d'abord anime-sama.to directement
  return fetch('https://anime-sama.to/catalogue/', {
    headers: { 'User-Agent': UA }
  }).then(function(r) {
    if (r.ok || r.status === 403) {
      console.log('[AnimeSama] anime-sama.to actif, on l\'utilise directement');
      _cachedBase = 'https://anime-sama.to';
      return _cachedBase;
    }
    throw new Error('anime-sama.to inactif (status ' + r.status + ')');
  }).catch(function(e) {
    console.warn('[AnimeSama]', e.message, '— recherche via anime-sama.pw');

    // Fallback : scraper le portail pivot pour trouver le bon domaine
    return fetch('https://anime-sama.pw/', {
      headers: { 'User-Agent': UA }
    }).then(function(r) { return r.text(); })
    .then(function(html) {
      var re = /https?:\/\/anime-sama\.([a-z]{2,})/gi;
      var found = [], m, seen = {};
      while ((m = re.exec(html)) !== null) {
        var tld = m[1].toLowerCase();
        if (tld !== 'pw' && tld !== 'fr' && !seen[tld]) {
          seen[tld] = true;
          found.push('https://anime-sama.' + tld);
        }
      }
      if (found.length) return testAndPickBase(found);
      throw new Error('Aucun domaine trouvé dans anime-sama.pw');
    })
    .catch(function() {
      // Dernier recours : liste hardcodée sans .to (déjà testé et mort)
      return testAndPickBase([
        'https://anime-sama.tv',
        'https://anime-sama.si',
        'https://anime-sama.eu',
      ]);
    });
  });
}

function testAndPickBase(candidates) {
  return candidates.reduce(function(chain, base) {
    return chain.then(function(found) {
      if (found) return found;
      return fetch(base + '/catalogue/', {
        headers: { 'User-Agent': UA },
        // timeout approximatif via signal pas dispo Hermes, on laisse fetch échouer naturellement
      }).then(function(r) {
        if (r.ok || r.status === 403) {
          console.log('[AnimeSama] Domaine actif:', base);
          _cachedBase = base;
          return base;
        }
        return null;
      }).catch(function() { return null; });
    });
  }, Promise.resolve(null)).then(function(base) {
    if (!base) {
      console.warn('[AnimeSama] Aucun domaine actif, fallback .tv');
      _cachedBase = 'https://anime-sama.tv';
      return _cachedBase;
    }
    return base;
  });
}

// ─── Helpers ─────────────────────────────────────────────────

function getText(url, referer, base) {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': referer || (base || 'https://anime-sama.tv') + '/',
      'Accept-Language': 'fr-FR,fr;q=0.9',
      'Accept': 'text/html,*/*;q=0.8',
    }
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
    return r.text();
  });
}

function getJson(url) {
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

// ─── TMDB : titres candidats ──────────────────────────────────

function getTitlesFromTmdb(tmdbId, mediaType) {
  var type = (mediaType === 'movie') ? 'movie' : 'tv';
  var url  = 'https://api.themoviedb.org/3/' + type + '/' + tmdbId
    + '?api_key=' + TMDB_KEY + '&language=fr-FR&append_to_response=alternative_titles';

  return getJson(url).then(function(d) {
    var seen = {}, titles = [];
    function add(t) {
      t = (t || '').trim();
      if (t && !seen[t]) { seen[t] = 1; titles.push(t); }
    }
    var frFull   = (d.name || d.title || '').trim();
    var frShort  = frFull.split(/\s*[:\-|]\s*/)[0].trim();
    var orig     = (d.original_name || d.original_title || '').trim();
    var origShort = orig.split(/\s*[:\-|]\s*/)[0].trim();

    add(frShort); add(frFull); add(origShort); add(orig);

    var arr = ((d.alternative_titles || {}).results || (d.alternative_titles || {}).titles || []);
    arr.forEach(function(a) {
      var t = (a.title || a.name || '').trim();
      add(t.split(/\s*[:\-|]\s*/)[0].trim());
      add(t);
    });

    console.log('[AnimeSama] Titres candidats:', titles.slice(0, 5));
    return titles;
  }).catch(function(e) {
    console.warn('[AnimeSama] TMDB fail:', e.message);
    return [];
  });
}

// ─── Recherche slug ───────────────────────────────────────────

function searchAnimeSama(query, base) {
  if (!query || query.length < 2) return Promise.resolve([]);

  return fetch(base + '/template-php/defaut/fetch.php', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Referer': base + '/',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'text/html, */*; q=0.01',
    },
    body: 'query=' + encodeURIComponent(query)
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }).then(function(html) {
    var results = [];
    // Cherche /catalogue/SLUG/ avec TLD dynamique
    var re = /href=["']https?:\/\/anime-sama\.[a-z]+\/catalogue\/([a-z0-9_-]+)\/?["']/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      if (results.indexOf(m[1]) === -1) results.push(m[1]);
    }
    // Fallback : cherche juste /catalogue/SLUG/
    if (!results.length) {
      re = /\/catalogue\/([a-z0-9_-]+)\//gi;
      while ((m = re.exec(html)) !== null) {
        if (results.indexOf(m[1]) === -1) results.push(m[1]);
      }
    }
    console.log('[AnimeSama] Slugs pour "' + query + '":', results);
    return results;
  }).catch(function(e) {
    console.warn('[AnimeSama] Search fail "' + query + '":', e.message);
    return [];
  });
}

function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreMatch(title, slug) {
  var a = norm(title), b = norm(slug.replace(/-/g, ' '));
  if (a === b) return 1;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 0.9;
  var wa = a.split(' '), wb = b.split(' ');
  var common = wa.filter(function(w) { return w.length > 2 && wb.indexOf(w) !== -1; });
  return common.length / Math.max(wa.length, wb.length, 1);
}

function resolveSlug(tmdbId, titles, base) {
  if (_cache[tmdbId]) {
    console.log('[AnimeSama] Cache hit:', _cache[tmdbId]);
    return Promise.resolve(_cache[tmdbId]);
  }

  var best = null, bestScore = 0;

  return titles.reduce(function(chain, title) {
    return chain.then(function() {
      if (bestScore >= 1) return;
      return searchAnimeSama(title, base).then(function(slugs) {
        slugs.forEach(function(slug) {
          var s = scoreMatch(title, slug);
          if (s > bestScore) { bestScore = s; best = slug; }
        });
      });
    });
  }, Promise.resolve()).then(function() {
    if (best) {
      console.log('[AnimeSama] Slug résolu:', best, '(score ' + bestScore.toFixed(2) + ')');
      _cache[tmdbId] = best;
    } else {
      console.warn('[AnimeSama] Slug introuvable');
    }
    return best;
  });
}

// ─── FIX CRITIQUE : filever avant episodes.js ─────────────────

function getFilever(seasonUrl, base) {
  console.log('[AnimeSama] Récupération filever depuis:', seasonUrl);
  return getText(seasonUrl, base + '/', base).then(function(html) {
    var m = html.match(/episodes\.js\?filever=(\d+)/);
    if (m) {
      console.log('[AnimeSama] Filever trouvé:', m[1]);
      return m[1];
    }
    console.warn('[AnimeSama] Filever introuvable dans la page saison');
    return null;
  }).catch(function(e) {
    console.warn('[AnimeSama] Filever fetch fail:', e.message);
    return null;
  });
}

function parseEpisodesJs(js) {
  var result = {};
  var varRe = /var\s+(eps\w*)\s*=\s*\[([\s\S]*?)\]\s*;/g;
  var m;
  while ((m = varRe.exec(js)) !== null) {
    var urls = [], urlRe = /['"]([^'"]+)['"]/g, u;
    while ((u = urlRe.exec(m[2])) !== null) {
      if (u[1].indexOf('http') === 0) urls.push(u[1].trim());
    }
    if (urls.length) result[m[1]] = urls;
  }
  return Object.keys(result).length ? result : null;
}

function fetchEpisodesJs(slug, season, lang, base) {
  var seasonUrl = base + '/catalogue/' + slug + '/saison' + season + '/' + lang + '/';
  
  // ÉTAPE 1 : récupérer filever depuis la page HTML
  return getFilever(seasonUrl, base).then(function(filever) {
    var url = seasonUrl + 'episodes.js';
    if (filever) url += '?filever=' + filever;
    
    console.log('[AnimeSama] episodes.js:', url);
    return getText(url, seasonUrl, base);
  }).then(function(js) {
    return parseEpisodesJs(js);
  }).catch(function() { return null; });
}

function fetchEpisodes(slug, season, base) {
  return LANGS.reduce(function(chain, lang) {
    return chain.then(function(found) {
      if (found) return found;
      return fetchEpisodesJs(slug, season, lang, base).then(function(eps) {
        return eps ? { eps: eps, lang: lang } : null;
      });
    });
  }, Promise.resolve(null));
}

// ─── Extracteurs embed (identiques à D3adlyRocket, éprouvés) ──

function extractSendvid(embedUrl) {
  var url = embedUrl.indexOf('/embed/') !== -1
    ? embedUrl
    : embedUrl.replace(/sendvid\.com\/([a-z0-9]+)/i, 'sendvid.com/embed/$1');
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': 'https://sendvid.com/' }
  }).then(function(r) { return r.text(); }).then(function(html) {
    var patterns = [
      /video_source\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
      /["'](https?:\/\/videos\d*\.sendvid\.com\/[^"'>\s]+\.mp4[^"'>\s]*)["']/i,
      /source\s+src=["']([^"']+\.mp4[^"']*)["']/i,
      /<source[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i,
      /file\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].exec(html);
      if (m) return m[1];
    }
    return null;
  }).then(function(u) {
    return u ? { url: u, fmt: 'mp4' } : null;
  }).catch(function() { return null; });
}

function extractSibnet(shellUrl) {
  return fetch(shellUrl, {
    headers: { 'User-Agent': UA, 'Referer': 'https://video.sibnet.ru/', 'Accept': 'text/html' }
  }).then(function(r) { return r.text(); })
  .then(function(html) {
    var m = /src\s*:\s*['"](\/v\/[^'"]+\.mp4)['"]/.exec(html)
         || /file\s*:\s*["'](\/v\/[^'"]+\.mp4)["']/.exec(html)
         || /["']((?:https?:)?\/\/[^"'\s]+\.mp4[^"'\s]*)["']/.exec(html);
    if (!m) return null;
    var path = m[1];
    if (path.startsWith('//')) return { url: 'https:' + path, referer: 'https://video.sibnet.ru/' };
    if (path.startsWith('/'))  return { url: 'https://video.sibnet.ru' + path, referer: 'https://video.sibnet.ru/' };
    return { url: path, referer: 'https://video.sibnet.ru/' };
  }).catch(function() { return null; });
}

function unpackEval(code) {
  try {
    if (code.indexOf('p,a,c,k,e,d') === -1) return code;
    var re = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)[\s\S]*?\}\s*\(([\s\S]*?)\)\s*\)/g;
    var m = re.exec(code);
    if (!m) return code;
    var args = m[1].match(/^'([\s\S]*?)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/s);
    if (!args) return code;
    var payload = args[1].replace(/\\'/g, "'");
    var base = parseInt(args[2]);
    var words = args[4].split('|');
    var count = parseInt(args[3]);
    var toBase = function(n) {
      return (n < base ? '' : toBase(Math.floor(n / base))) + ((n = n % base) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    };
    var dict = {};
    while (count--) dict[toBase(count)] = words[count] || toBase(count);
    return payload.replace(/\b\w+\b/g, function(w) { return dict[w] || w; });
  } catch (e) { return code; }
}

function extractVidmoly(embedUrl) {
  var url = embedUrl.replace(/vidmoly\.(net|to|ru|is)/i, 'vidmoly.me');
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': 'https://vidmoly.me/', 'Origin': 'https://vidmoly.me' }
  }).then(function(r) { return r.text(); })
  .then(function(html) {
    if (html.indexOf('p,a,c,k,e,d') !== -1) html = unpackEval(html);
    var m3 = /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i.exec(html)
           || /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i.exec(html);
    if (m3) return { url: m3[1], fmt: 'm3u8' };
    var m4 = /file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i.exec(html);
    if (m4) return { url: m4[1], fmt: 'mp4' };
    return null;
  }).catch(function() { return null; });
}

function extractUrl(embedUrl, base) {
  if (!embedUrl) return Promise.resolve(null);

  // URLs directes anime-sama.fr → serveurs morts, on skip
  if (embedUrl.indexOf('anime-sama.fr') !== -1) {
    console.warn('[AnimeSama] Skipped anime-sama.fr (hors ligne)');
    return Promise.resolve(null);
  }
  // URL directe mp4/m3u8
  if (/\.(mp4|m3u8)(\?|$)/i.test(embedUrl)) {
    return Promise.resolve({
      url: embedUrl,
      fmt: embedUrl.indexOf('.m3u8') !== -1 ? 'm3u8' : 'mp4'
    });
  }
  if (embedUrl.indexOf('sendvid.com') !== -1) return extractSendvid(embedUrl);
  if (embedUrl.indexOf('sibnet.ru')   !== -1) {
    return extractSibnet(embedUrl).then(function(res) {
      return res ? { url: res.url, fmt: 'mp4', referer: res.referer } : null;
    });
  }
  if (embedUrl.indexOf('vidmoly')     !== -1) return extractVidmoly(embedUrl);
  return Promise.resolve(null);
}

// ─── Construction des streams ─────────────────────────────────

var PRIO   = { epsAS: 100, eps3: 70, eps2: 60, eps1: 50 };
var LABELS = { epsAS: 'Anime-Sama Direct', eps1: 'Sibnet', eps2: 'Vidmoly', eps3: 'Sendvid' };

function buildStreams(epsData, epIndex, season, episode, base) {
  var lang = epsData.lang;
  var flag = lang === 'vf' ? '[VF]' : '[VOSTFR]';
  var eps  = epsData.eps;

  var keys = Object.keys(eps).sort(function(a, b) {
    return (PRIO[b] || 30) - (PRIO[a] || 30);
  });

  var promises = keys.map(function(key) {
    var embedUrl = (eps[key] || [])[epIndex];
    if (!embedUrl) return Promise.resolve(null);

    return extractUrl(embedUrl, base).then(function(res) {
      if (!res || !res.url) return null;
      return {
        name:    'AnimeSama',
        title:   flag + ' ' + (LABELS[key] || key) + ' | S' + season + 'E' + episode,
        url:     res.url,
        quality: res.fmt === 'm3u8' ? 'HD' : 'Auto',
        format:  res.fmt,
        headers: {
          'User-Agent': UA,
          'Referer': res.referer || base + '/'
        },
        _prio: PRIO[key] || 30
      };
    }).catch(function() { return null; });
  });

  return Promise.all(promises).then(function(results) {
    return results
      .filter(Boolean)
      .sort(function(a, b) { return b._prio - a._prio; })
      .map(function(r) { delete r._prio; return r; });
  });
}

// ─── Interface publique ───────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  var s   = season  || 1;
  var e   = episode || 1;
  var idx = e - 1;
  var activeBase;

  console.log('[AnimeSama] getStreams tmdbId=' + tmdbId + ' S' + s + 'E' + e);

  return detectAnimeSamaBase()
    .then(function(base) {
      activeBase = base;
      return getTitlesFromTmdb(tmdbId, mediaType);
    })
    .then(function(titles) {
      if (!titles.length) throw new Error('Aucun titre TMDB');
      return resolveSlug(tmdbId, titles, activeBase);
    })
    .then(function(slug) {
      if (!slug) throw new Error('Slug introuvable');
      return fetchEpisodes(slug, s, activeBase);
    })
    .then(function(epsData) {
      if (!epsData) throw new Error('Aucun épisode trouvé');
      return buildStreams(epsData, idx, s, e, activeBase);
    })
    .catch(function(err) {
      console.error('[AnimeSama] Erreur finale:', err && err.message || err);
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
