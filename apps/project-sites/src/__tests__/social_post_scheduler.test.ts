import {generateCalendar,BEST_TIMES} from '../services/social_post_scheduler.js';
describe('social_post_scheduler',()=>{
it('BEST_TIMES has 4 platforms',()=>{expect(Object.keys(BEST_TIMES).length).toBe(4)});
it('generates calendar',()=>{const c=generateCalendar({platforms:['x'],postsPerWeek:2,contentType:'blog',startDate:'2026-06-29'},4);expect(c.length).toBe(8)});
it('defaults to 4 weeks',()=>{expect(generateCalendar({platforms:['linkedin'],postsPerWeek:1,contentType:'update',startDate:'2026-06-01'}).length).toBe(4)});
it('ISO dates',()=>{expect(generateCalendar({platforms:['x'],postsPerWeek:1,contentType:'test',startDate:'2026-06-29'},1)[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)});
});
