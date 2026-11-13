// Default question bank + a deck that deals questions without repeats until exhausted.
import { shuffle } from '../shared/util.js';

const Q = (q, options, answer, category, difficulty = 'easy') => ({ q, options, answer, category, difficulty });

export const DEFAULT_QUESTIONS = [
  Q('What is 7 × 8?', ['54', '56', '64', '48'], 1, 'Maths'),
  Q('What is the square root of 144?', ['10', '11', '12', '14'], 2, 'Maths'),
  Q('What is 15% of 200?', ['15', '20', '30', '35'], 2, 'Maths', 'medium'),
  Q('Which number is prime?', ['21', '27', '29', '33'], 2, 'Maths', 'medium'),
  Q('What is 3³ (three cubed)?', ['9', '18', '27', '81'], 2, 'Maths'),
  Q('How many degrees are in a right angle?', ['45', '90', '180', '360'], 1, 'Maths'),
  Q('What is ½ + ¼?', ['¾', '⅔', '⅖', '1'], 0, 'Maths'),
  Q('Solve: 2x + 6 = 20. x = ?', ['5', '6', '7', '8'], 2, 'Maths', 'medium'),
  Q('How many sides does a hexagon have?', ['5', '6', '7', '8'], 1, 'Maths'),
  Q('What is 0.25 written as a fraction?', ['1/2', '1/3', '1/4', '1/5'], 2, 'Maths'),
  Q('What is the area of a 6 m × 4 m rectangle?', ['10 m²', '20 m²', '24 m²', '28 m²'], 2, 'Maths'),
  Q('What is 1,000 ÷ 8?', ['115', '120', '125', '130'], 2, 'Maths', 'medium'),
  Q('Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Jupiter', 'Mercury'], 1, 'Science'),
  Q('What gas do plants absorb from the air?', ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'], 2, 'Science'),
  Q('What is the chemical symbol for gold?', ['Go', 'Gd', 'Au', 'Ag'], 2, 'Science', 'medium'),
  Q('Water boils at what temperature at sea level?', ['90 °C', '100 °C', '110 °C', '120 °C'], 1, 'Science'),
  Q('What part of the cell holds its DNA?', ['Ribosome', 'Nucleus', 'Membrane', 'Cytoplasm'], 1, 'Science', 'medium'),
  Q('Which force keeps planets in orbit around the Sun?', ['Magnetism', 'Friction', 'Gravity', 'Tension'], 2, 'Science'),
  Q('What is the hardest natural substance?', ['Gold', 'Iron', 'Diamond', 'Quartz'], 2, 'Science'),
  Q('How many bones are in the adult human body?', ['186', '206', '226', '256'], 1, 'Science', 'hard'),
  Q('Which organ pumps blood around the body?', ['Lungs', 'Liver', 'Heart', 'Kidneys'], 2, 'Science'),
  Q('What is the largest planet in our solar system?', ['Saturn', 'Jupiter', 'Neptune', 'Earth'], 1, 'Science'),
  Q('Light travels fastest through…', ['Water', 'Glass', 'A vacuum', 'Air'], 2, 'Science', 'medium'),
  Q('What is H₂O commonly called?', ['Salt', 'Water', 'Hydrogen', 'Peroxide'], 1, 'Science'),
  Q('Which element has atomic number 1?', ['Helium', 'Hydrogen', 'Oxygen', 'Carbon'], 1, 'Science', 'medium'),
  Q('What type of energy is stored in a stretched spring?', ['Kinetic', 'Thermal', 'Elastic potential', 'Nuclear'], 2, 'Science', 'hard'),
  Q('What is the capital of Australia?', ['Sydney', 'Melbourne', 'Canberra', 'Perth'], 2, 'Geography', 'medium'),
  Q('Which is the longest river in the world?', ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], 1, 'Geography', 'medium'),
  Q('Which continent is the Sahara Desert on?', ['Asia', 'Africa', 'Australia', 'South America'], 1, 'Geography'),
  Q('What is the largest ocean on Earth?', ['Atlantic', 'Indian', 'Arctic', 'Pacific'], 3, 'Geography'),
  Q('Mount Everest lies on the border of Nepal and…', ['India', 'China', 'Bhutan', 'Pakistan'], 1, 'Geography', 'hard'),
  Q('Which country has the largest population (2024)?', ['USA', 'China', 'India', 'Indonesia'], 2, 'Geography', 'medium'),
  Q('What is the capital of Canada?', ['Toronto', 'Vancouver', 'Ottawa', 'Montreal'], 2, 'Geography', 'medium'),
  Q('How many continents are there?', ['5', '6', '7', '8'], 2, 'Geography'),
  Q('Which line divides Earth into the Northern and Southern hemispheres?', ['Prime Meridian', 'Equator', 'Tropic of Cancer', 'Date Line'], 1, 'Geography'),
  Q('In which year did World War II end?', ['1943', '1945', '1947', '1950'], 1, 'History', 'medium'),
  Q('Who was the first person to walk on the Moon?', ['Buzz Aldrin', 'Yuri Gagarin', 'Neil Armstrong', 'John Glenn'], 2, 'History'),
  Q('The ancient pyramids of Giza are in which country?', ['Mexico', 'Peru', 'Egypt', 'Sudan'], 2, 'History'),
  Q('Who painted the Mona Lisa?', ['Michelangelo', 'Leonardo da Vinci', 'Raphael', 'Van Gogh'], 1, 'History'),
  Q('Which empire built the Colosseum?', ['Greek', 'Roman', 'Ottoman', 'Persian'], 1, 'History'),
  Q('The printing press was developed by…', ['Gutenberg', 'Edison', 'Newton', 'Galileo'], 0, 'History', 'medium'),
  Q('Which is the largest mammal?', ['Elephant', 'Blue whale', 'Giraffe', 'Orca'], 1, 'Nature'),
  Q('How many legs does a spider have?', ['6', '8', '10', '12'], 1, 'Nature'),
  Q('What do bees make?', ['Silk', 'Wax only', 'Honey', 'Milk'], 2, 'Nature'),
  Q('A baby frog is called a…', ['Cub', 'Tadpole', 'Kit', 'Fry'], 1, 'Nature'),
  Q('Which bird is a famous symbol of peace?', ['Eagle', 'Dove', 'Crow', 'Owl'], 1, 'Nature'),
  Q('What is the plural of "mouse"?', ['Mouses', 'Mice', 'Meese', 'Mousen'], 1, 'English'),
  Q('Which word is a synonym of "rapid"?', ['Slow', 'Quick', 'Heavy', 'Quiet'], 1, 'English'),
  Q('Which of these is a verb?', ['Happy', 'Run', 'Blue', 'Table'], 1, 'English'),
  Q('What does CPU stand for?', ['Central Processing Unit', 'Computer Power Unit', 'Core Program Utility', 'Central Print Unit'], 0, 'Technology', 'medium'),
  Q('Binary 101 equals which decimal number?', ['3', '4', '5', '6'], 2, 'Technology', 'hard'),
  Q('Which company makes the iPhone?', ['Samsung', 'Google', 'Apple', 'Sony'], 2, 'Technology'),
];

export class QuestionDeck {
  constructor(questions, rng = Math.random, shuffleOptions = true) {
    this.rng = rng;
    this.shuffleOptions = shuffleOptions;
    this.src = (questions && questions.length ? questions : DEFAULT_QUESTIONS).map((q, i) => ({ ...q, id: i }));
    this.order = [];
    this.uid = 0;
  }
  next() {
    if (!this.order.length) this.order = shuffle(this.src.map((q) => q.id), this.rng);
    const q = this.src[this.order.pop()];
    let options = q.options.slice();
    let answer = q.answer;
    if (this.shuffleOptions) {
      const idx = shuffle(options.map((_, i) => i), this.rng);
      options = idx.map((i) => q.options[i]);
      answer = idx.indexOf(q.answer);
    }
    return { uid: ++this.uid, srcId: q.id, q: q.q, options, answer, category: q.category, difficulty: q.difficulty };
  }
}

export function toCSV(questions) {
  const esc = (s) => /[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  const lines = ['question,option_a,option_b,option_c,option_d,answer,category,difficulty'];
  for (const q of questions) {
    const o = [0, 1, 2, 3].map((i) => q.options[i] || '');
    lines.push([q.q, ...o, 'ABCD'[q.answer], q.category, q.difficulty].map(esc).join(','));
  }
  return lines.join('\n') + '\n';
}
