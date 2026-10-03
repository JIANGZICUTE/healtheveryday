const SOURCE = '常见食物典型值（参考，可编辑）';

const CATEGORY_OPTIONAL_NUTRIENTS = Object.freeze({
  '主食': { fiber: 2, sodium: 5, potassium: 120 },
  '肉禽': { fiber: 0, sodium: 55, potassium: 250 },
  '水产': { fiber: 0, sodium: 80, potassium: 300 },
  '蛋奶豆': { fiber: 0.5, sodium: 60, potassium: 180 },
  '蔬菜': { fiber: 2.2, sodium: 30, potassium: 260 },
  '水果': { fiber: 2, sodium: 2, potassium: 180 },
  '坚果': { fiber: 7, sodium: 10, potassium: 500 },
  '零食饮品': { fiber: 1.5, sodium: 100, potassium: 120 },
  '调味': { fiber: 1, sodium: 500, potassium: 200 }
});

const OPTIONAL_NUTRIENT_OVERRIDES = Object.freeze({
  'rice-cooked': { fiber: 0.3, sodium: 1, potassium: 30 },
  'rice-raw': { fiber: 0.8, sodium: 2, potassium: 110 },
  'sugar': { fiber: 0, sodium: 1, potassium: 2 },
  'honey': { fiber: 0.2, sodium: 4, potassium: 52 },
  'soy-sauce': { fiber: 0.8, sodium: 6000, potassium: 337 },
  'banana': { fiber: 2.6, sodium: 1, potassium: 358 },
  'spinach': { fiber: 2.2, sodium: 79, potassium: 558 },
  'broccoli': { fiber: 3.3, sodium: 41, potassium: 293 },
  'avocado': { fiber: 6.7, sodium: 7, potassium: 485 }
});

function optionalNutrients(id, category) {
  return { ...(CATEGORY_OPTIONAL_NUTRIENTS[category] || { fiber: 0, sodium: 0, potassium: 0 }), ...(OPTIONAL_NUTRIENT_OVERRIDES[id] || {}) };
}
const f = (id, name, pinyin, category, state, kcal, carbs, protein, fat, aliases = []) => ({
  id,
  name,
  aliases: [pinyin, ...aliases].filter(Boolean),
  pinyin,
  category,
  state,
  source: SOURCE,
  custom: false,
  per100g: { kcal, carbs, protein, fat, ...optionalNutrients(id, category) }
});

export const FOOD_LIBRARY = Object.freeze([
  f('rice-cooked', '米饭（熟）', 'mifan', '主食', '熟', 116, 25.9, 2.6, 0.3, ['白米饭']),
  f('rice-raw', '大米（生）', 'dami', '主食', '生', 346, 77.2, 7.4, 0.8, ['稻米']),
  f('congee', '白粥（熟）', 'baizhou', '主食', '熟', 46, 9.9, 1.1, 0.2, ['稀饭']),
  f('mantou', '馒头（熟）', 'mantou', '主食', '熟', 223, 47, 7, 1.1, []),
  f('whole-wheat-bread', '全麦面包（熟）', 'quanmaimianbao', '主食', '熟', 247, 41, 13, 3.4, ['吐司']),
  f('noodles-cooked', '面条（熟）', 'miantiao', '主食', '熟', 110, 23.1, 4.5, 0.5, ['煮面']),
  f('noodles-raw', '面条（生）', 'shengmiantiao', '主食', '生', 301, 61.9, 11, 0.6, []),
  f('oats-dry', '燕麦片（生）', 'yanmaipian', '主食', '生', 377, 66.3, 15, 6.7, ['麦片']),
  f('corn-cooked', '玉米（熟）', 'yumi', '主食', '熟', 112, 22.8, 4, 1.2, ['甜玉米']),
  f('sweet-potato', '红薯（熟）', 'hongshu', '主食', '熟', 86, 20.1, 1.6, 0.1, ['地瓜']),
  f('potato', '土豆（熟）', 'tudou', '主食', '熟', 77, 17.5, 2, 0.1, ['马铃薯']),
  f('purple-potato', '紫薯（熟）', 'zishu', '主食', '熟', 82, 19.2, 1.4, 0.2, []),
  f('yam', '山药（熟）', 'shanyao', '主食', '熟', 57, 12.4, 1.9, 0.2, []),
  f('taro', '芋头（熟）', 'yutou', '主食', '熟', 56, 12.9, 1.5, 0.2, []),
  f('rice-noodles', '米粉（熟）', 'mifen', '主食', '熟', 109, 24.9, 1.6, 0.2, []),
  f('vermicelli', '粉丝（熟）', 'fensi', '主食', '熟', 84, 20.4, 0.1, 0.1, []),
  f('glutinous-rice', '糯米（生）', 'nuomi', '主食', '生', 350, 76.9, 7.3, 1, []),
  f('millet-dry', '小米（生）', 'xiaomi', '主食', '生', 361, 75.1, 9, 3.1, []),
  f('quinoa-dry', '藜麦（生）', 'limai', '主食', '生', 368, 64.2, 14.1, 6.1, []),
  f('pork-dumpling', '猪肉水饺（熟）', 'shuijiao', '主食', '熟', 240, 30, 10, 9, ['饺子']),

  f('chicken-breast-cooked', '鸡胸肉（熟）', 'jixiongrou', '肉禽', '熟', 165, 0, 31, 3.6, ['鸡胸']),
  f('chicken-breast-raw', '鸡胸肉（生）', 'shengjixiong', '肉禽', '生', 118, 0, 24, 1.9, []),
  f('chicken-thigh-cooked', '鸡腿肉（熟）', 'jituirou', '肉禽', '熟', 209, 0, 26, 11, ['鸡腿']),
  f('chicken-wing-cooked', '鸡翅（熟）', 'jichi', '肉禽', '熟', 266, 0, 24, 18, []),
  f('pork-lean-cooked', '瘦猪肉（熟）', 'shouzhurou', '肉禽', '熟', 190, 0, 27, 8, ['猪里脊']),
  f('pork-belly-cooked', '五花肉（熟）', 'wuhuarou', '肉禽', '熟', 518, 0, 9, 53, []),
  f('pork-ribs-cooked', '排骨（熟）', 'paigu', '肉禽', '熟', 278, 0, 22, 20, []),
  f('beef-lean-cooked', '瘦牛肉（熟）', 'shouniurou', '肉禽', '熟', 205, 0, 29, 9, ['牛里脊']),
  f('beef-brisket-cooked', '牛腩（熟）', 'niunan', '肉禽', '熟', 332, 0, 22, 26, []),
  f('lamb-cooked', '羊肉（熟）', 'yangrou', '肉禽', '熟', 258, 0, 25, 17, []),
  f('duck-cooked', '鸭肉（熟）', 'yarou', '肉禽', '熟', 240, 0, 19, 18, []),
  f('bacon-cooked', '培根（熟）', 'peigen', '肉禽', '熟', 541, 1.4, 37, 42, []),
  f('sausage-cooked', '香肠（熟）', 'xiangchang', '肉禽', '熟', 508, 2, 24, 45, []),
  f('ham', '火腿（熟）', 'huotui', '肉禽', '熟', 229, 1, 18, 17, []),
  f('meatball', '肉丸（熟）', 'rouwan', '肉禽', '熟', 240, 8, 15, 16, []),

  f('salmon-cooked', '三文鱼（熟）', 'sanwenyu', '水产', '熟', 206, 0, 22, 13, []),
  f('cod-cooked', '鳕鱼（熟）', 'xueyu', '水产', '熟', 105, 0, 23, 0.9, []),
  f('sea-bass-cooked', '鲈鱼（熟）', 'luyu', '水产', '熟', 124, 0, 24, 3, []),
  f('grass-carp-cooked', '草鱼（熟）', 'caoyu', '水产', '熟', 113, 0, 23, 2, []),
  f('shrimp-cooked', '虾（熟）', 'xia', '水产', '熟', 99, 0.2, 24, 0.3, ['大虾']),
  f('prawn-cooked', '基围虾（熟）', 'jiweixia', '水产', '熟', 101, 0, 22, 1, []),
  f('crab-cooked', '螃蟹（可食部）', 'pangxie', '水产', '可食部', 97, 0, 20, 1.5, []),
  f('clam-cooked', '蛤蜊（可食部）', 'geli', '水产', '可食部', 74, 2.6, 13, 1, []),
  f('squid-cooked', '鱿鱼（熟）', 'youyu', '水产', '熟', 92, 3.1, 15, 1.4, []),
  f('tuna-canned', '金枪鱼罐头（水浸）', 'jinqiangyu', '水产', '可食部', 116, 0, 26, 1, []),
  f('seaweed-dry', '紫菜（生）', 'zicai', '水产', '生', 250, 44, 26, 1, []),
  f('kelp-cooked', '海带（熟）', 'haidai', '水产', '熟', 43, 9.6, 1.7, 0.6, []),

  f('egg-whole', '鸡蛋（去壳）', 'jidan', '蛋奶豆', '可食部', 144, 1.3, 13, 9.5, ['全蛋']),
  f('egg-white', '蛋清（可食部）', 'danqing', '蛋奶豆', '可食部', 52, 0.7, 11, 0.2, ['鸡蛋清']),
  f('egg-yolk', '蛋黄（可食部）', 'danhuang', '蛋奶豆', '可食部', 322, 3.6, 16, 27, ['鸡蛋黄']),
  f('quail-egg', '鹌鹑蛋（去壳）', 'anchundan', '蛋奶豆', '可食部', 158, 0.4, 13, 11, []),
  f('milk-whole', '全脂牛奶', 'quanzhiniunai', '蛋奶豆', '可食部', 61, 4.8, 3.2, 3.3, ['牛奶']),
  f('milk-skim', '脱脂牛奶', 'tuozhiniunai', '蛋奶豆', '可食部', 34, 5, 3.4, 0.1, []),
  f('yogurt-plain', '原味酸奶', 'suannai', '蛋奶豆', '可食部', 72, 9.3, 2.5, 2.7, []),
  f('greek-yogurt', '希腊酸奶', 'xilasuannai', '蛋奶豆', '可食部', 97, 3.6, 9, 5, []),
  f('cheese', '奶酪', 'nailao', '蛋奶豆', '可食部', 402, 1.3, 25, 33, []),
  f('tofu-north', '北豆腐', 'beidoufu', '蛋奶豆', '可食部', 116, 3, 12, 7, ['老豆腐']),
  f('tofu-south', '南豆腐', 'nandoufu', '蛋奶豆', '可食部', 87, 3.9, 6.2, 5.8, ['嫩豆腐']),
  f('dried-tofu', '豆腐干', 'doufugan', '蛋奶豆', '可食部', 197, 8, 16, 12, ['香干']),
  f('soy-milk', '无糖豆浆', 'doujiang', '蛋奶豆', '可食部', 33, 1.8, 3, 1.6, []),
  f('edamame', '毛豆（熟）', 'maodou', '蛋奶豆', '熟', 121, 8.9, 12, 5.2, []),
  f('tofu-skin', '豆腐皮（熟）', 'doufupi', '蛋奶豆', '熟', 185, 7, 20, 9, ['千张']),
  f('tempeh', '天贝（熟）', 'tianbei', '蛋奶豆', '熟', 195, 8, 20, 11, []),
  f('soybean-dry', '黄豆（生）', 'huangdou', '蛋奶豆', '生', 390, 34, 35, 16, ['大豆']),

  f('chinese-cabbage', '大白菜', 'dabaicai', '蔬菜', '可食部', 13, 2.2, 1.5, 0.2, ['白菜']),
  f('bok-choy', '小白菜', 'xiaobaicai', '蔬菜', '可食部', 15, 2.4, 1.5, 0.3, ['青菜']),
  f('spinach', '菠菜（熟）', 'bocai', '蔬菜', '熟', 23, 3.8, 2.9, 0.4, []),
  f('lettuce', '生菜', 'shengcai', '蔬菜', '可食部', 15, 2.9, 1.4, 0.2, []),
  f('tomato', '番茄', 'fanqie', '蔬菜', '可食部', 18, 3.9, 0.9, 0.2, ['西红柿']),
  f('cucumber', '黄瓜', 'huanggua', '蔬菜', '可食部', 15, 3.6, 0.7, 0.1, []),
  f('carrot', '胡萝卜（熟）', 'huluobo', '蔬菜', '熟', 41, 9.6, 0.9, 0.2, []),
  f('radish', '白萝卜', 'bailuobo', '蔬菜', '可食部', 18, 4.1, 0.7, 0.1, []),
  f('broccoli', '西兰花（熟）', 'xilanhua', '蔬菜', '熟', 35, 7.2, 2.4, 0.4, []),
  f('cauliflower', '菜花（熟）', 'caihua', '蔬菜', '熟', 25, 5, 1.9, 0.3, ['花椰菜']),
  f('cabbage', '卷心菜', 'juanxincai', '蔬菜', '可食部', 25, 5.8, 1.3, 0.1, ['包菜']),
  f('celery', '芹菜（熟）', 'qincai', '蔬菜', '熟', 18, 4, 0.8, 0.2, []),
  f('eggplant', '茄子（熟）', 'qiezi', '蔬菜', '熟', 35, 8.7, 0.8, 0.2, []),
  f('zucchini', '西葫芦（熟）', 'xihulu', '蔬菜', '熟', 17, 3.1, 1.2, 0.3, []),
  f('pumpkin', '南瓜（熟）', 'nangua', '蔬菜', '熟', 26, 6.5, 1, 0.1, []),
  f('winter-melon', '冬瓜（熟）', 'donggua', '蔬菜', '熟', 13, 3, 0.4, 0.2, []),
  f('bell-pepper', '彩椒', 'caijiao', '蔬菜', '可食部', 26, 6, 1, 0.2, ['甜椒']),
  f('onion', '洋葱（熟）', 'yangcong', '蔬菜', '熟', 44, 10.2, 1.2, 0.1, []),
  f('mushroom', '口蘑（熟）', 'koumo', '蔬菜', '熟', 28, 5.4, 2.2, 0.4, []),
  f('shiitake-cooked', '香菇（熟）', 'xianggu', '蔬菜', '熟', 48, 11, 1.5, 0.2, []),
  f('enoki-cooked', '金针菇（熟）', 'jinzhengu', '蔬菜', '熟', 37, 7.8, 2.2, 0.3, []),
  f('wood-ear-soaked', '木耳（泡发熟）', 'muer', '蔬菜', '熟', 27, 6, 0.5, 0.2, []),
  f('green-beans', '四季豆（熟）', 'sijidou', '蔬菜', '熟', 35, 7, 2, 0.2, []),
  f('peas', '豌豆（熟）', 'wandou', '蔬菜', '熟', 84, 15.6, 5.4, 0.2, []),
  f('lotus-root', '莲藕（熟）', 'lianou', '蔬菜', '熟', 66, 16, 1.6, 0.1, []),

  f('apple', '苹果', 'pingguo', '水果', '可食部', 52, 13.8, 0.3, 0.2, []),
  f('banana', '香蕉', 'xiangjiao', '水果', '可食部', 93, 22, 1.4, 0.2, []),
  f('orange', '橙子', 'chengzi', '水果', '可食部', 48, 11.1, 0.9, 0.2, ['橙']),
  f('mandarin', '橘子', 'juzi', '水果', '可食部', 44, 10.2, 0.8, 0.1, ['柑橘']),
  f('pear', '梨', 'li', '水果', '可食部', 51, 13.1, 0.4, 0.1, []),
  f('peach', '桃子', 'taozi', '水果', '可食部', 42, 10.1, 0.6, 0.1, []),
  f('grape', '葡萄', 'putao', '水果', '可食部', 45, 10.3, 0.5, 0.2, []),
  f('strawberry', '草莓', 'caomei', '水果', '可食部', 32, 7.7, 0.7, 0.3, []),
  f('blueberry', '蓝莓', 'lanmei', '水果', '可食部', 57, 14.5, 0.7, 0.3, []),
  f('watermelon', '西瓜', 'xigua', '水果', '可食部', 31, 7.6, 0.6, 0.2, []),
  f('cantaloupe', '哈密瓜', 'hamigua', '水果', '可食部', 34, 8.2, 0.8, 0.2, ['甜瓜']),
  f('kiwi', '猕猴桃', 'mihoutao', '水果', '可食部', 61, 14.7, 1.1, 0.5, ['奇异果']),
  f('mango', '芒果', 'mangguo', '水果', '可食部', 60, 15, 0.8, 0.4, []),
  f('pineapple', '菠萝', 'boluo', '水果', '可食部', 50, 13.1, 0.5, 0.1, ['凤梨']),
  f('dragon-fruit', '火龙果', 'huolongguo', '水果', '可食部', 55, 13.3, 1.1, 0.2, []),
  f('papaya', '木瓜', 'mugua', '水果', '可食部', 43, 10.8, 0.5, 0.3, []),
  f('cherry', '樱桃', 'yingtao', '水果', '可食部', 63, 16, 1.1, 0.2, ['车厘子']),
  f('lychee', '荔枝', 'lizhi', '水果', '可食部', 66, 16.5, 0.8, 0.4, []),
  f('avocado', '牛油果', 'niuyouguo', '水果', '可食部', 160, 8.5, 2, 15, ['鳄梨']),
  f('grapefruit', '柚子', 'youzi', '水果', '可食部', 42, 10.7, 0.8, 0.1, []),

  f('peanut', '花生（生）', 'huasheng', '坚果', '生', 574, 21, 24, 44, []),
  f('walnut', '核桃（可食部）', 'hetao', '坚果', '可食部', 646, 19, 14, 59, []),
  f('almond', '巴旦木', 'badanmu', '坚果', '可食部', 579, 22, 21, 50, ['杏仁']),
  f('cashew', '腰果', 'yaoguo', '坚果', '可食部', 553, 30, 18, 44, []),
  f('pistachio', '开心果', 'kaixinguo', '坚果', '可食部', 560, 28, 20, 45, []),
  f('sunflower-seed', '葵花籽仁', 'kuihuazi', '坚果', '可食部', 584, 20, 21, 51, []),
  f('pumpkin-seed', '南瓜籽仁', 'nanguazi', '坚果', '可食部', 559, 11, 30, 49, []),
  f('sesame', '芝麻', 'zhima', '坚果', '可食部', 573, 23, 18, 50, []),
  f('chia-seed', '奇亚籽', 'qiyazi', '坚果', '可食部', 486, 42, 17, 31, []),
  f('peanut-butter', '花生酱', 'huashengjiang', '坚果', '可食部', 588, 20, 25, 50, []),

  f('black-coffee', '美式咖啡', 'meishikafei', '零食饮品', '可食部', 2, 0.3, 0.1, 0, ['黑咖啡']),
  f('latte', '拿铁咖啡', 'natiekafei', '零食饮品', '可食部', 54, 5.1, 3, 2.5, []),
  f('cola', '可乐', 'kele', '零食饮品', '可食部', 42, 10.6, 0, 0, []),
  f('sparkling-water', '无糖气泡水', 'qipaoshui', '零食饮品', '可食部', 0, 0, 0, 0, ['苏打水']),
  f('orange-juice', '橙汁', 'chengzhi', '零食饮品', '可食部', 45, 10.4, 0.7, 0.2, []),
  f('milk-tea', '奶茶（全糖）', 'naicha', '零食饮品', '可食部', 95, 15, 2, 3.2, []),
  f('crackers', '苏打饼干', 'sudabinggan', '零食饮品', '可食部', 430, 70, 9, 13, []),
  f('potato-chips', '薯片', 'shupian', '零食饮品', '可食部', 536, 53, 7, 35, []),
  f('chocolate', '黑巧克力', 'heiqiaokeli', '零食饮品', '可食部', 598, 46, 7.8, 43, []),
  f('cookie', '曲奇饼干', 'quqibinggan', '零食饮品', '可食部', 520, 63, 6, 27, []),
  f('ice-cream', '冰淇淋', 'bingqilin', '零食饮品', '可食部', 207, 24, 3.5, 11, []),
  f('rice-cake', '米饼', 'mibing', '零食饮品', '可食部', 384, 82, 7, 3, []),

  f('olive-oil', '橄榄油', 'ganlanyou', '调味', '可食部', 884, 0, 0, 100, []),
  f('peanut-oil', '花生油', 'huashengyou', '调味', '可食部', 899, 0, 0, 100, []),
  f('sugar', '白砂糖', 'baishatang', '调味', '可食部', 400, 100, 0, 0, ['糖']),
  f('honey', '蜂蜜', 'fengmi', '调味', '可食部', 304, 82, 0.3, 0, []),
  f('soy-sauce', '生抽酱油', 'shengchou', '调味', '可食部', 53, 5.6, 8.1, 0.1, ['酱油'])
]);

export function searchFoods(foods, query, limit = 30) {
  const needle = normalize(query);
  if (!needle) return foods.slice(0, limit);
  return foods
    .map(food => ({ food, score: scoreFood(food, needle) }))
    .filter(item => item.score < Number.POSITIVE_INFINITY)
    .sort((a, b) => a.score - b.score || a.food.name.localeCompare(b.food.name, 'zh-CN'))
    .slice(0, limit)
    .map(item => item.food);
}

function scoreFood(food, needle) {
  const name = normalize(food.name);
  const aliases = (food.aliases || []).map(normalize);
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (aliases.some(alias => alias === needle)) return 2;
  if (aliases.some(alias => alias.startsWith(needle))) return 3;
  if (name.includes(needle)) return 4;
  if (aliases.some(alias => alias.includes(needle))) return 5;
  return Number.POSITIVE_INFINITY;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s·（）()_-]/g, '');
}