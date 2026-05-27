import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UtilZod } from './util-zod';

describe('UtilZod', () => {
  let component: UtilZod;
  let fixture: ComponentFixture<UtilZod>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UtilZod],
    }).compileComponents();

    fixture = TestBed.createComponent(UtilZod);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
