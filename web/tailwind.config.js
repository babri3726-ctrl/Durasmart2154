/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#172554',
        ink: '#182033',
        muted: '#738099',
        faint: '#9AA4B7',
        canvas: '#F5F6FC',
        line: '#E4E8F2',
        brand: {
          blue: '#3977F6',
          purple: '#8750F5',
          orange: '#FF9D43',
          teal: '#19BBA5',
          pink: '#ED5DA8',
          green: '#1DA96B',
          red: '#E24B5A',
          whatsapp: '#20AD6A',
        },
      },
      backgroundImage: {
        'sidebar-grad': 'linear-gradient(160deg, #172554 0%, #1E3A8A 45%, #4C1D95 100%)',
        'brand-grad': 'linear-gradient(135deg, #3178F6 0%, #8050F3 50%, #B74CEB 100%)',
        'grad-sales': 'linear-gradient(135deg, #3977F6, #8750F5)',
        'grad-payment': 'linear-gradient(135deg, #19BBA5, #3977F6)',
        'grad-marketing': 'linear-gradient(135deg, #ED5DA8, #8750F5)',
        'grad-dispatch': 'linear-gradient(135deg, #8750F5, #ED5DA8)',
        'grad-stock': 'linear-gradient(135deg, #1DA96B, #19BBA5)',
        'grad-account': 'linear-gradient(135deg, #3977F6, #19BBA5)',
        'grad-area': 'linear-gradient(135deg, #FF9D43, #FF6F61)',
        'grad-tour': 'linear-gradient(135deg, #9257F4, #ED5DA8)',
        'grad-task': 'linear-gradient(135deg, #3977F6, #8750F5)',
        'grad-customer': 'linear-gradient(135deg, #19BBA5, #3977F6)',
        'grad-order': 'linear-gradient(135deg, #FF9D43, #ED5DA8)',
        'grad-employee': 'linear-gradient(135deg, #19BBA5, #9257F4)',
        'grad-danger': 'linear-gradient(135deg, #FF9D43, #E24B5A)',
        'grad-success': 'linear-gradient(135deg, #1DA96B, #19BBA5)',
      },
      borderRadius: {
        card: '20px',
        tile: '22px',
        field: '14px',
      },
      boxShadow: {
        card: '0 6px 24px rgba(23, 37, 84, 0.08)',
        pop: '0 12px 40px rgba(23, 37, 84, 0.16)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
