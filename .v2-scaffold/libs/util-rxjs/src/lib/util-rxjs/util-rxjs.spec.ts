import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UtilRxjs } from './util-rxjs';

describe('UtilRxjs', () => {
  let component: UtilRxjs;
  let fixture: ComponentFixture<UtilRxjs>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UtilRxjs],
    }).compileComponents();

    fixture = TestBed.createComponent(UtilRxjs);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
