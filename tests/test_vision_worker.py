import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('worker',Path(__file__).resolve().parents[1]/'vision_worker.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)

class CaptureLifecycleTests(unittest.TestCase):
    def test_capture_rate_counts_publications_not_repeated_reads(self):
        slot=worker._Latest()
        with patch.object(worker.time,'perf_counter',side_effect=[1.,1.5,2.]):
            slot.publish(('a',640,640),2);slot.publish(('b',640,640),4);slot.publish(('c',640,640),6)
        stats=slot.stats();self.assertEqual(stats['captureFps'],2);self.assertEqual(stats['captureFrames'],3);self.assertEqual(stats['captureCallbackMs'],4)

    def test_empty_capture_rate_is_zero(self):
        self.assertEqual(worker._Latest().stats()['captureFps'],0)

    def test_owned_error_dialog_does_not_duplicate_the_stream_title(self):
        class Windows:
            def GetWindowTextLengthW(self,hwnd):return len('PS Remote Play')
            def GetWindowTextW(self,hwnd,buffer,size):buffer.value='PS Remote Play'
            def IsWindowVisible(self,hwnd):return True
            def GetWindow(self,hwnd,kind):return 1 if hwnd==2 else 0
            def EnumWindows(self,callback,value):callback(1,0);callback(2,0)
        self.assertEqual(worker._find_window(Windows(),'PS Remote Play'),1)

    def test_multiple_independent_stream_windows_remain_ambiguous(self):
        class Windows:
            def GetWindowTextLengthW(self,hwnd):return len('PS Remote Play')
            def GetWindowTextW(self,hwnd,buffer,size):buffer.value='PS Remote Play'
            def IsWindowVisible(self,hwnd):return True
            def GetWindow(self,hwnd,kind):return 0
            def EnumWindows(self,callback,value):callback(1,0);callback(2,0)
        with self.assertRaisesRegex(RuntimeError,'found 2'):worker._find_window(Windows(),'PS Remote Play')

    def test_latest_slot_discards_old_frames(self):
        slot=worker._Latest();slot.publish(('old',640,360));slot.publish(('new',1920,1057))
        self.assertEqual(slot.read(),('new',1920,1057,2))

    def test_capture_error_propagates(self):
        slot=worker._Latest();slot.fail(RuntimeError('target closed'))
        with self.assertRaisesRegex(RuntimeError,'target closed'):slot.read()

    def test_temporary_missing_frames_are_distinct_from_closed_capture(self):
        slot=worker._Latest()
        with self.assertRaises(worker.CaptureTimeout):slot.read(timeout=0)
        slot.publish(('restored',1920,1057));self.assertEqual(slot.read()[0],'restored')

    def test_wgc_startup_read_accepts_timeout(self):
        capture=worker.WgcCapture.__new__(worker.WgcCapture);capture.slot=worker._Latest()
        capture.slot.publish(('frame',1920,1057));self.assertEqual(capture.read(timeout=.01)[1:3],(1920,1057))

    def test_failed_wgc_is_closed_before_fallback(self):
        events=[]
        class Unavailable:
            def __init__(self,title):events.append('wgc')
            def read(self,*args,**kwargs):raise RuntimeError('no frame')
            def close(self):events.append('closed')
        def fallback(title):events.append('fallback');return 'gdi'
        with patch.object(worker,'WgcCapture',Unavailable),patch.object(worker,'GdiCapture',fallback):
            self.assertEqual(worker.create_capture('test'),'gdi')
        self.assertEqual(events,['wgc','closed','fallback'])

if __name__=='__main__':unittest.main()
