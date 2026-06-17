import type { Meta, StoryObj } from '@storybook/angular';
import { MenuBoardComponent } from './menu-board.component';

const meta: Meta<MenuBoardComponent> = {
  title: 'Site Kit/Industry/MenuBoard',
  component: MenuBoardComponent,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<MenuBoardComponent>;

export const Default: Story = {
  args: {
    heading: 'Our Menu',
  },
};

export const Pizzeria: Story = {
  args: {
    heading: 'Pizza Menu',
    categories: [
      {
        title: 'Pizzas',
        items: [
          { name: 'Margherita', description: 'San Marzano tomatoes, fior di latte, fresh basil.', price: 16, badge: 'Classic', dietary: ['V'] },
          { name: 'Pepperoni', description: 'Tomato sauce, mozzarella, sliced pepperoni, chili flakes.', price: 18 },
          { name: 'Truffle Mushroom', description: 'White truffle oil, wild mushrooms, fontina, thyme.', price: 22, badge: 'Seasonal' },
        ],
      },
      {
        title: 'Sides',
        items: [
          { name: 'Garlic Knots', description: 'Baked in-house, herb butter, marinara dip.', price: 8, dietary: ['V'] },
          { name: 'Caesar Salad', description: 'Romaine, house-made dressing, shaved parm, croutons.', price: 12 },
        ],
      },
    ],
  },
};
