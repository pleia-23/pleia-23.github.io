// 大师风格标签库 V0 —— 手工维护的「风格 → 匹配规则」数据
// 每条规则的 match(colors) 接收前端 canvas 提取的调色板：
//   colors = [{ h:0~360, s:0~1, l:0~1, hex:'#rrggbb', rgb:[r,g,b] }, ...]
// 返回 true 表示这张照片命中该风格。可同时命中多个，前端取命中度最高的若干个。
// 后续若要接 AI 风格识别，只需把 match 换成模型打分，前端无需改动。
(function () {
  function hueDist(a, b){ let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  const T = [
    {
      id: 'morandi', name: '莫兰迪色系', emoji: '🌫️',
      desc: '低饱和、带灰调的中性色，温柔克制、显高级。',
      hint: '#b3a394',
      match: c => c.length >= 1 && c.every(x => x.s < 0.30 && x.l > 0.34 && x.l < 0.82)
    },
    {
      id: 'macaron', name: '马卡龙色', emoji: '🍬',
      desc: '高明度粉彩，甜美轻盈像甜点。',
      hint: '#f4c2d7',
      match: c => c.length >= 1 && c.every(x => x.l > 0.66 && x.s > 0.18 && x.s < 0.55)
    },
    {
      id: 'cyberpunk', name: '赛博朋克', emoji: '🌃',
      desc: '高饱和霓虹：冷蓝与品红/荧光粉对撞。',
      hint: '#ff2bd6',
      match: c => {
        const s = c.filter(x => x.s > 0.55);
        if (s.length < 1) return false;
        const hasBlue = c.some(x => x.h >= 200 && x.h <= 265);
        const hasPink = c.some(x => (x.h >= 285 && x.h <= 335) || (x.h >= 340 || x.h <= 15));
        return hasBlue && hasPink;
      }
    },
    {
      id: 'bw', name: '极简黑白', emoji: '⚫',
      desc: '近乎无彩、强对比，干净利落。',
      hint: '#222222',
      match: c => {
        if (c.some(x => x.s > 0.16)) return false;
        const ls = c.map(x => x.l);
        return (Math.max(...ls) - Math.min(...ls)) > 0.4;
      }
    },
    {
      id: 'vintage', name: '复古胶片', emoji: '🎞️',
      desc: '暖调、中等饱和，像老照片的温润感。',
      hint: '#cfa37a',
      match: c => {
        const warm = c.filter(x => (x.h < 55 || x.h >= 300) && x.s > 0.12 && x.s < 0.62 && x.l > 0.3 && x.l < 0.82);
        return warm.length >= Math.ceil(c.length * 0.6);
      }
    },
    {
      id: 'earthy', name: '大地自然', emoji: '🍂',
      desc: '棕、橄榄、苔绿等自然泥土色。',
      hint: '#8a6f4e',
      match: c => {
        const e = c.filter(x => ((x.h >= 15 && x.h <= 85) || (x.h >= 85 && x.h <= 160)) && x.s > 0.12 && x.s < 0.6);
        return e.length >= Math.ceil(c.length * 0.5);
      }
    },
    {
      id: 'complementary', name: '对撞', emoji: '⚡',
      desc: '两种主色在色环上相距约 180°，张力强。',
      hint: '#2e8bff',
      match: c => {
        if (c.length < 2) return false;
        return hueDist(c[0].h, c[1].h) > 150;
      }
    },
    {
      id: 'analogous', name: '和声', emoji: '🌿',
      desc: '色相彼此靠近，过渡自然舒服。',
      hint: '#7bc47b',
      match: c => {
        if (c.length < 2) return false;
        const hs = c.map(x => x.h).sort((a, b) => a - b);
        let maxGap = 0;
        for (let i = 1; i < hs.length; i++) maxGap = Math.max(maxGap, hs[i] - hs[i - 1]);
        return maxGap < 70;
      }
    },
    {
      id: 'triadic', name: '三音色', emoji: '🔺',
      desc: '三种主色均匀分布在色环上，活泼又稳。',
      hint: '#e8b84b',
      match: c => {
        if (c.length < 3) return false;
        return Math.abs(hueDist(c[0].h, c[1].h) - 120) < 35 && Math.abs(hueDist(c[1].h, c[2].h) - 120) < 35;
      }
    },
    {
      id: 'nordic', name: '北欧清冷', emoji: '❄️',
      desc: '高亮度、低饱和、偏冷调，干净通透。',
      hint: '#cfe3e8',
      match: c => c.length >= 1 && c.every(x => x.l > 0.55 && x.s < 0.32 && ((x.h >= 160 && x.h <= 260) || x.s < 0.12))
    },
    {
      id: 'vibrant', name: '高饱和撞色', emoji: '🔥',
      desc: '整体鲜艳浓烈，视觉冲击强。',
      hint: '#ff5a3c',
      match: c => c.length >= 2 && c.filter(x => x.s > 0.6).length >= Math.ceil(c.length * 0.66)
    },
    {
      id: 'dreamy', name: '渐变梦幻', emoji: '🌈',
      desc: '多组浅淡相近色，像柔光渐变。',
      hint: '#c9b6ff',
      match: c => c.length >= 3 && c.every(x => x.l > 0.6 && x.s < 0.5)
    }
  ];
  // 为了兼容不同加载顺序，挂到 window 与 module 导出
  if (typeof window !== 'undefined') window.STYLE_TAGS = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})();
