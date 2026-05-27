import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureLogs } from './feature-logs';

describe('FeatureLogs', () => {
  let component: FeatureLogs;
  let fixture: ComponentFixture<FeatureLogs>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureLogs],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureLogs);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
