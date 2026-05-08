// ============================================================
// Provider Nuvio : Anime-Sama (anime-sama.to)
// Version      : 7.1.0 PATCHED
// Moteur       : Promise chains UNIQUEMENT (Hermes / React Native)
//                AUCUN async/await, AUCUN require() Node.js
// Langues      : VF priorité, fallback VOSTFR
// Sources      : sendvid > vidmoly > sibnet > oneupload
// ============================================================

var AS_BASE = 'https://anime-sama.to';
var AS_REF  = AS_BASE + '/';

var UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var TMDB_KEY = '2dca580c2a14b55200e784d157207b4d';

// Cache mémoire tmdbId → slug anime-sama
var _cache = {};

// Ordre de test des langues
var LANGS = ['vf', 'vostfr'];

// ─── Helpers réseau ──────────────────────────────────────────

function getText(url, referer) {
    return fetch(url, {
        headers: {
            'User-Agent': UA,
            'Referer': referer || AS_REF,
            'Accept-Language': 'fr-FR,fr;q=0.9'
        }
    }).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
        return r.text();
    });
}

function getJson(url) {
    return fetch(url, {
        headers: {
            'User-Agent': UA,
            'Accept': 'application/json'
        }
    }).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    });
}

// ─── Étape 1 : tmdbId → titres candidats ─────────────────────

function getTitlesFromTmdb(tmdbId, mediaType) {

    var type = (mediaType === 'movie') ? 'movie' : 'tv';

    var url =
        'https://api.themoviedb.org/3/' +
        type +
        '/' +
        tmdbId +
        '?api_key=' +
        TMDB_KEY +
        '&language=fr-FR&append_to_response=alternative_titles';

    console.log('[AnimeSama] TMDB:', url);

    return getJson(url)
    .then(function(d) {

        var seen = {};
        var titles = [];

        function add(t) {
            t = (t || '').trim();

            if (t && !seen[t]) {
                seen[t] = 1;
                titles.push(t);
            }
        }

        var frFull = (d.name || d.title || '').trim();
        var frShort = frFull.split(/\s*[:\-|]\s*/)[0].trim();

        var orig = (d.original_name || d.original_title || '').trim();
        var origShort = orig.split(/\s*[:\-|]\s*/)[0].trim();

        add(frShort);
        add(frFull);

        add(origShort);
        add(orig);

        var arr =
            ((d.alternative_titles || {}).results || (d.alternative_titles || {}).titles || []);

        arr.forEach(function(a) {

            var t = (a.title || a.name || '').trim();

            add(t.split(/\s*[:\-|]\s*/)[0].trim());
            add(t);
        });

        console.log('[AnimeSama] Titres candidats:', titles.slice(0, 6));

        return titles;

    }).catch(function(e) {

        console.warn('[AnimeSama] TMDB fail:', e.message);
        return [];
    });
}

// ─── Étape 2 : Recherche slug sur anime-sama ─────────────────

function searchAnimeSama(query) {

    if (!query || query.length < 2)
        return Promise.resolve([]);

    return fetch(
        AS_BASE + '/template-php/defaut/fetch.php',
        {
            method: 'POST',
            headers: {
                'User-Agent': UA,
                'Referer': AS_REF,
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: 'query=' + encodeURIComponent(query)
        }
    )
    .then(function(r) {

        if (!r.ok)
            throw new Error('HTTP ' + r.status);

        return r.text();
    })
    .then(function(html) {

        var results = [];

        var re =
            /href=["']https?:\/\/anime-sama\.[a-z]+\/catalogue\/([a-z0-9_-]+)\/?["']/gi;

        var m;

        while ((m = re.exec(html)) !== null) {

            if (results.indexOf(m[1]) === -1)
                results.push(m[1]);
        }

        console.log('[AnimeSama] Slugs pour "' + query + '":', results);

        return results;

    }).catch(function(e) {

        console.warn('[AnimeSama] Search fail pour "' + query + '":', e.message);
        return [];
    });
}

// ─── Étape 2b : Score similarité ─────────────────────────────

function norm(s) {

    return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreMatch(title, slug) {

    var a = norm(title);
    var b = norm(slug.replace(/-/g, ' '));

    if (a === b)
        return 1;

    if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1)
        return 0.9;

    var wa = a.split(' ');
    var wb = b.split(' ');

    var common = wa.filter(function(w) {
        return w.length > 2 && wb.indexOf(w) !== -1;
    });

    return common.length / Math.max(wa.length, wb.length, 1);
}

// ─── Étape 2c : Résolution slug ──────────────────────────────

function resolveSlug(tmdbId, titles) {

    if (_cache[tmdbId]) {

        console.log('[AnimeSama] Cache hit:', _cache[tmdbId]);
        return Promise.resolve(_cache[tmdbId]);
    }

    var best = null;
    var bestScore = 0;

    return titles.reduce(function(chain, title) {

        return chain.then(function() {

            if (bestScore >= 1)
                return;

            return searchAnimeSama(title)
            .then(function(slugs) {

                slugs.forEach(function(slug) {

                    var s = scoreMatch(title, slug);

                    if (s > bestScore) {

                        bestScore = s;
                        best = slug;
                    }
                });
            });
        });

    }, Promise.resolve())

    .then(function() {

        if (best) {

            console.log(
                '[AnimeSama] Slug résolu:',
                best,
                '(score ' + bestScore.toFixed(2) + ')'
            );

            _cache[tmdbId] = best;

        } else {

            console.warn(
                '[AnimeSama] Slug introuvable pour tmdbId=' + tmdbId
            );
        }

        return best;
    });
}

// ─── Étape 3 : Parse episodes.js ─────────────────────────────

function parseEpisodesJs(js) {

    var result = {};

    var varRe = /var\s+(eps\w*)\s*=\s*\[([\s\S]*?)\]\s*;/g;

    var m;

    while ((m = varRe.exec(js)) !== null) {

        var urls = [];

        var urlRe = /['"]([^'"]+)['"]/g;

        var u;

        while ((u = urlRe.exec(m[2])) !== null) {

            if (u[1].indexOf('http') === 0)
                urls.push(u[1].trim());
        }

        if (urls.length)
            result[m[1]] = urls;
    }

    return Object.keys(result).length ? result : null;
}

function fetchEpisodesJs(slug, season, lang) {

    var url =
        AS_BASE +
        '/catalogue/' +
        slug +
        '/saison' +
        season +
        '/' +
        lang +
        '/episodes.js';

    console.log('[AnimeSama] episodes.js:', url);

    return getText(url, AS_REF)
    .then(function(js) {

        return parseEpisodesJs(js);

    }).catch(function() {

        return null;
    });
}

function fetchEpisodes(slug, season) {

    return LANGS.reduce(function(chain, lang) {

        return chain.then(function(found) {

            if (found)
                return found;

            return fetchEpisodesJs(slug, season, lang)
            .then(function(eps) {

                return eps ? { eps: eps, lang: lang } : null;
            });
        });

    }, Promise.resolve(null));
}

// ─── Extracteurs ──────────────────────────────────────────────

function extractSendvid(embedUrl) {

    var url =
        embedUrl.indexOf('/embed/') !== -1
        ? embedUrl
        : embedUrl.replace(
            /sendvid\.com\/([a-z0-9]+)/i,
            'sendvid.com/embed/$1'
        );

    return fetch(url, {
        headers: {
            'User-Agent': UA,
            'Referer': 'https://sendvid.com/'
        }
    })
    .then(function(r) {

        if (!r.ok)
            throw new Error('HTTP ' + r.status);

        return r.text();
    })
    .then(function(html) {

        var patterns = [

            /video_source\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,

            /["'](https?:\/\/videos\d*\.sendvid\.com\/[^"'>\s]+\.mp4[^"'>\s]*)["']/i,

            /source\s+src=["']([^"']+\.mp4[^"']*)["']/i,

            /<source[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i,

            /file\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i,

            /["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i
        ];

        for (var i = 0; i < patterns.length; i++) {

            var m = patterns[i].exec(html);

            if (m)
                return m[1];
        }

        return null;

    }).catch(function() {

        return null;
    });
}

function extractSibnet(shellUrl) {

    return fetch(shellUrl, {
        headers: {
            'User-Agent': UA,
            'Referer': 'https://video.sibnet.ru/',
            'Accept': 'text/html'
        }
    })
    .then(function(r) {

        return r.text();
    })
    .then(function(html) {

        var m =
            /src\s*:\s*['"](\/v\/[^'"]+\.mp4)['"]/.exec(html) ||
            /file\s*:\s*["'](\/v\/[^'"]+\.mp4)["']/.exec(html) ||
            /["']((?:https?:)?\/\/[^"'\s]+\.mp4[^"'\s]*)["']/.exec(html);

        if (!m)
            return null;

        var path = m[1];

        if (path.startsWith('//')) {

            return {
                url: 'https:' + path,
                referer: 'https://video.sibnet.ru/'
            };
        }

        if (path.startsWith('/')) {

            return {
                url: 'https://video.sibnet.ru' + path,
                referer: 'https://video.sibnet.ru/'
            };
        }

        return {
            url: path,
            referer: 'https://video.sibnet.ru/'
        };

    }).catch(function() {

        return null;
    });
}

function unpackEval(code) {

    try {

        if (code.indexOf('p,a,c,k,e,d') === -1)
            return code;

        var re =
            /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)[\s\S]*?\}\s*\(([\s\S]*?)\)\s*\)/g;

        var m = re.exec(code);

        if (!m)
            return code;

        var args =
            m[1].match(
                /^'([\s\S]*?)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/s
            );

        if (!args)
            return code;

        var payload = args[1].replace(/\\'/g, "'");
        var base = parseInt(args[2]);
        var count = parseInt(args[3]);

        var words = args[4].split('|');

        var toBase = function(n) {

            return (
                (n < base ? '' : toBase(Math.floor(n / base))) +
                ((n = n % base) > 35
                    ? String.fromCharCode(n + 29)
                    : n.toString(36))
            );
        };

        var dict = {};

        while (count--)
            dict[toBase(count)] = words[count] || toBase(count);

        return payload.replace(/\b\w+\b/g, function(w) {

            return dict[w] || w;
        });

    } catch (e) {

        return code;
    }
}

function extractVidmoly(embedUrl) {

    var url =
        embedUrl.replace(
            /vidmoly\.(net|to|ru|is)/i,
            'vidmoly.me'
        );

    var ref = 'https://vidmoly.me/';

    return fetch(url, {
        headers: {
            'User-Agent': UA,
            'Referer': ref,
            'Origin': 'https://vidmoly.me'
        }
    })
    .then(function(r) {

        if (!r.ok)
            throw new Error('HTTP ' + r.status);

        return r.text();
    })
    .then(function(html) {

        var redir =
            /window\.location\.(?:replace|href)\s*=\s*['"]([^'"]+)['"]/.exec(html);

        if (redir && redir[1] !== url) {

            return fetch(redir[1], {
                headers: {
                    'User-Agent': UA,
                    'Referer': ref
                }
            }).then(function(r2) {

                return r2.text();
            });
        }

        return html;
    })
    .then(function(html) {

        if (html.indexOf('p,a,c,k,e,d') !== -1)
            html = unpackEval(html);

        var m3 =
            /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i.exec(html) ||
            /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i.exec(html);

        if (m3)
            return {
                url: m3[1],
                fmt: 'm3u8'
            };

        var m4 =
            /file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i.exec(html) ||
            /["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i.exec(html);

        if (m4)
            return {
                url: m4[1],
                fmt: 'mp4'
            };

        return null;

    }).catch(function() {

        return null;
    });
}

function extractOneupload(embedUrl) {

    return getText(embedUrl, 'https://oneupload.to/')
    .then(function(html) {

        var m3 =
            /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i.exec(html);

        if (m3)
            return {
                url: m3[1],
                fmt: 'm3u8'
            };

        var m4 =
            /["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i.exec(html);

        if (m4)
            return {
                url: m4[1],
                fmt: 'mp4'
            };

        return null;

    }).catch(function() {

        return null;
    });
}

function validateDirectUrl(url) {

    var timeout = new Promise(function(_, reject) {

        setTimeout(function() {

            reject(new Error('timeout'));

        }, 5000);
    });

    var check = fetch(url, {
        method: 'HEAD',
        headers: {
            'User-Agent': UA,
            'Referer': AS_REF
        }
    })
    .then(function(r) {

        return r.ok;

    }).catch(function() {

        return false;
    });

    return Promise.race([check, timeout])
    .catch(function() {

        return false;
    });
}

function extractUrl(embedUrl) {

    if (/\.(mp4|m3u8)(\?|$)/i.test(embedUrl)) {

        if (embedUrl.indexOf('anime-sama.fr') !== -1) {

            console.warn(
                '[AnimeSama] epsAS ignore:',
                embedUrl
            );

            return Promise.resolve(null);
        }

        return validateDirectUrl(embedUrl)
        .then(function(ok) {

            if (!ok) {

                console.warn(
                    '[AnimeSama] epsAS inaccessible:',
                    embedUrl
                );

                return null;
            }

            return {
                url: embedUrl,
                fmt:
                    embedUrl.indexOf('.m3u8') !== -1
                    ? 'm3u8'
                    : 'mp4'
            };
        });
    }

    if (embedUrl.indexOf('sendvid.com') !== -1) {

        return extractSendvid(embedUrl)
        .then(function(u) {

            return u
                ? {
                    url: u,
                    fmt: 'mp4'
                }
                : null;
        });
    }

    if (embedUrl.indexOf('sibnet.ru') !== -1) {

        return extractSibnet(embedUrl)
        .then(function(res) {

            if (!res)
                return null;

            return {
                url: res.url,
                fmt: 'mp4',
                referer: res.referer
            };
        });
    }

    if (embedUrl.indexOf('vidmoly.to') !== -1) {

        return extractVidmoly(embedUrl);
    }

    if (embedUrl.indexOf('oneupload.to') !== -1) {

        return extractOneupload(embedUrl);
    }

    return Promise.resolve(null);
}

// ─── Streams ─────────────────────────────────────────────────

var PRIO = {
    epsAS: 100,
    eps3: 70,
    eps2: 60,
    eps1: 50
};

var LABELS = {
    epsAS: 'Anime-Sama Direct',
    eps1: 'Sibnet',
    eps2: 'Vidmoly',
    eps3: 'Sendvid/OneUpload'
};

function buildStreams(epsData, epIndex, season, episode) {

    var lang = epsData.lang;

    var flag =
        lang === 'vf'
        ? '[VF]'
        : '[VOSTFR]';

    var eps = epsData.eps;

    var keys =
        Object.keys(eps)
        .sort(function(a, b) {

            return (PRIO[b] || 30) - (PRIO[a] || 30);
        });

    var promises = keys.map(function(key) {

        var embedUrl = (eps[key] || [])[epIndex];

        if (!embedUrl)
            return Promise.resolve(null);

        return extractUrl(embedUrl)
        .then(function(res) {

            if (!res || !res.url)
                return null;

            var streamReferer = res.referer || AS_REF;

            return {
                name: 'AnimeSama',

                title:
                    flag +
                    ' ' +
                    (LABELS[key] || key) +
                    ' | S' +
                    season +
                    'E' +
                    episode,

                url: res.url,

                quality:
                    res.fmt === 'm3u8'
                    ? 'HD'
                    : 'Auto',

                format: res.fmt,

                headers: {
                    'User-Agent': UA,
                    'Referer': streamReferer
                },

                _prio: PRIO[key] || 30
            };

        }).catch(function() {

            return null;
        });
    });

    return Promise.all(promises)
    .then(function(results) {

        return results
        .filter(Boolean)
        .sort(function(a, b) {

            return b._prio - a._prio;

        })
        .map(function(r) {

            delete r._prio;
            return r;
        });
    });
}

// ─── Interface publique ──────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {

    var s = season || 1;
    var e = episode || 1;
    var idx = e - 1;

    console.log(
        '[AnimeSama] getStreams tmdbId=' +
        tmdbId +
        ' type=' +
        mediaType +
        ' S' +
        s +
        'E' +
        e
    );

    function pipeline() {

        return getTitlesFromTmdb(tmdbId, mediaType)

        .then(function(titles) {

            if (!titles.length)
                throw new Error('Aucun titre TMDB');

            return resolveSlug(tmdbId, titles);
        })

        .then(function(slug) {

            if (!slug)
                throw new Error('Slug introuvable');

            return fetchEpisodes(slug, s);
        })

        .then(function(epsData) {

            if (!epsData)
                throw new Error('Aucun épisode trouvé');

            return buildStreams(epsData, idx, s, e);
        });
    }

    return pipeline()
    .catch(function(err) {

        console.error(
            '[AnimeSama] Erreur:',
            err && err.message || err
        );

        return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {

    module.exports = {
        getStreams
    };

} else {

    global.getStreams = getStreams;
}
