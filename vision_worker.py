"""JSONL image/video/window inference worker for the desktop app."""
import argparse
import base64
import contextlib
import ctypes
import json
import os
import sys
import tempfile
import threading
import time
from collections import deque
from ctypes import wintypes as W
from pathlib import Path

MODEL_SIZE = 640
SRCCOPY = 0x00CC0020
HALFTONE = 4
PREVIEW_MAX_WIDTH = 720
PREVIEW_QUALITY = 62
# The UI preview is for a human; the controller only needs `objects`. Encoding a
# JPEG on every frame would burn both worker time and GPU in the renderer.
PREVIEW_INTERVAL = 0.125

def emit(value):
    print(json.dumps(value),flush=True)

class _BitmapInfoHeader(ctypes.Structure):
    _fields_=[('biSize',ctypes.c_uint32),('biWidth',ctypes.c_int32),('biHeight',ctypes.c_int32),
              ('biPlanes',ctypes.c_uint16),('biBitCount',ctypes.c_uint16),('biCompression',ctypes.c_uint32),
              ('biSizeImage',ctypes.c_uint32),('biXPelsPerMeter',ctypes.c_int32),('biYPelsPerMeter',ctypes.c_int32),
              ('biClrUsed',ctypes.c_uint32),('biClrImportant',ctypes.c_uint32)]

def _user32():
    user=ctypes.windll.user32
    try:ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:pass
    user.GetWindowTextLengthW.argtypes=[W.HWND]
    user.GetWindowTextW.argtypes=[W.HWND,W.LPWSTR,ctypes.c_int]
    user.IsWindowVisible.argtypes=[W.HWND];user.IsIconic.argtypes=[W.HWND]
    user.IsWindowEnabled.argtypes=[W.HWND]
    user.GetWindow.argtypes=[W.HWND,W.UINT];user.GetWindow.restype=W.HWND
    user.GetClientRect.argtypes=[W.HWND,ctypes.POINTER(W.RECT)]
    user.GetWindowRect.argtypes=[W.HWND,ctypes.POINTER(W.RECT)]
    user.ClientToScreen.argtypes=[W.HWND,ctypes.POINTER(W.POINT)]
    return user

def _find_window(user,title):
    matches=[]
    callback=ctypes.WINFUNCTYPE(W.BOOL,W.HWND,W.LPARAM)
    def inspect(hwnd,_):
        length=user.GetWindowTextLengthW(hwnd)
        buffer=ctypes.create_unicode_buffer(length+1)
        user.GetWindowTextW(hwnd,buffer,length+1)
        # Error dialogs inherit Remote Play's title. Capture the independent
        # streaming window, not its owned modal popup.
        if buffer.value==title and user.IsWindowVisible(hwnd) and not user.GetWindow(hwnd,4):matches.append(hwnd)
        return True
    user.EnumWindows(callback(inspect),0)
    if len(matches)!=1:raise RuntimeError(f'Expected one visible window titled {title!r}; found {len(matches)}')
    return matches[0]

def _client_geometry(user,hwnd):
    """Return (screen_x, screen_y, width, height, offset_x, offset_y).

    The offsets locate the client area inside the window frame, which is what a
    window-targeted capture hands back (title bar and borders included).
    """
    rect=W.RECT();point=W.POINT(0,0);frame=W.RECT()
    if not user.GetClientRect(hwnd,ctypes.byref(rect)) or not user.ClientToScreen(hwnd,ctypes.byref(point)):
        raise RuntimeError('Could not obtain window client area')
    width,height=rect.right-rect.left,rect.bottom-rect.top
    if width<10 or height<10:raise RuntimeError('Window client area is empty')
    offset_x=offset_y=0
    if user.GetWindowRect(hwnd,ctypes.byref(frame)):
        # WGC omits DWM's invisible resize borders. GetWindowRect includes them,
        # which otherwise trims eight real pixels from a maximized game view.
        try:
            dwm=ctypes.windll.dwmapi
            dwm.DwmGetWindowAttribute.argtypes=[W.HWND,W.DWORD,ctypes.c_void_p,W.DWORD]
            dwm.DwmGetWindowAttribute(hwnd,9,ctypes.byref(frame),ctypes.sizeof(frame))
        except Exception:pass
        offset_x,offset_y=point.x-frame.left,point.y-frame.top
    return point.x,point.y,width,height,max(0,offset_x),max(0,offset_y)

class CaptureTimeout(TimeoutError):
    """A restored/minimized window can temporarily stop producing frames."""

class _Latest:
    """Single-slot handoff between a capture thread and the inference loop."""
    def __init__(self):
        self._lock=threading.Lock();self._ready=threading.Event()
        self._value=None;self._seq=0;self._error=None
        self._times=deque(maxlen=180);self._costs=deque(maxlen=180)
    def publish(self,value,capture_ms=0):
        with self._lock:
            self._value=value;self._seq+=1;self._times.append(time.perf_counter());self._costs.append(capture_ms)
        self._ready.set()
    def stats(self):
        with self._lock:
            return {'captureFps':(len(self._times)-1)/max(.001,self._times[-1]-self._times[0]) if len(self._times)>1 else 0,
                    'captureCallbackMs':sum(self._costs)/max(1,len(self._costs)),'captureFrames':self._seq}
    def fail(self,error):
        with self._lock:self._error=error
        self._ready.set()
    def read(self,last_seq=0,timeout=5.0):
        deadline=time.perf_counter()+timeout
        while True:
            with self._lock:
                if self._error:raise self._error
                if self._value is not None and self._seq!=last_seq:
                    frame,width,height=self._value
                    return frame,width,height,self._seq
            if time.perf_counter()>deadline:raise CaptureTimeout('Waiting for fresh window frames')
            self._ready.wait(.05);self._ready.clear()

class WgcCapture:
    """Windows Graphics Capture, targeted at the window itself.

    WGC receives the window's own composited frames, so another window sitting on
    top no longer blanks out the capture, and the frames arrive on the compositor's
    schedule instead of costing a synchronous GDI readback.
    """
    def __init__(self,title,size=MODEL_SIZE):
        from windows_capture import WindowsCapture
        import cv2
        self.user=_user32();self.hwnd=_find_window(self.user,title);self.size=size
        self.slot=_Latest()
        self.capture=WindowsCapture(cursor_capture=False,draw_border=False,window_hwnd=self.hwnd,minimum_update_interval=0)
        capture=self.capture
        @capture.event
        def on_frame_arrived(frame,capture_control):
            try:
                callback_start=time.perf_counter()
                if self.user.IsIconic(self.hwnd) or not self.user.IsWindowEnabled(self.hwnd):return
                buffer=frame.frame_buffer
                height,width=buffer.shape[:2]
                _,_,client_w,client_h,offset_x,offset_y=_client_geometry(self.user,self.hwnd)
                # Trim the title bar/borders so the model's centre matches the game's.
                x1,y1=min(offset_x,max(0,width-1)),min(offset_y,max(0,height-1))
                x2,y2=min(width,x1+client_w),min(height,y1+client_h)
                view=buffer[y1:y2,x1:x2]
                if view.size==0:return
                small=cv2.resize(view,(self.size,self.size),interpolation=cv2.INTER_LINEAR)
                converted=cv2.cvtColor(small,cv2.COLOR_BGRA2BGR)
                self.slot.publish((converted,x2-x1,y2-y1),(time.perf_counter()-callback_start)*1000)
            except Exception as error:
                self.slot.fail(error)
                with contextlib.suppress(Exception):capture_control.stop()
        @capture.event
        def on_closed():
            self.slot.fail(RuntimeError('Capture target window closed'))
        self.control=capture.start_free_threaded()
    def read(self,last_seq=0,timeout=5.0):
        return self.slot.read(last_seq,timeout)
    def close(self):
        with contextlib.suppress(Exception):self.control.stop()

class GdiCapture:
    """Fallback: GDI StretchBlt straight into the model's input size.

    StretchBlt scales during the blit, so only MODEL_SIZE*MODEL_SIZE*4 bytes leave
    the driver instead of a full-resolution frame. Used when WGC is unavailable.
    """
    def __init__(self,title,size=MODEL_SIZE):
        self.user=_user32();self.hwnd=_find_window(self.user,title);self.size=size
        self.slot=_Latest();self._stop=threading.Event()
        self._thread=threading.Thread(target=self._run,name='gdi-capture',daemon=True)
        self._thread.start()
    def _run(self):
        gdi=ctypes.windll.gdi32;screen_dc=mem_dc=bitmap=previous=None
        try:
            # HDC/HBITMAP are pointer-sized on 64-bit Python.
            self.user.GetDC.argtypes=[W.HWND];self.user.GetDC.restype=ctypes.c_void_p
            self.user.ReleaseDC.argtypes=[W.HWND,ctypes.c_void_p]
            gdi.CreateCompatibleDC.argtypes=[ctypes.c_void_p];gdi.CreateCompatibleDC.restype=ctypes.c_void_p
            gdi.CreateDIBSection.argtypes=[ctypes.c_void_p,ctypes.c_void_p,W.UINT,ctypes.POINTER(ctypes.c_void_p),ctypes.c_void_p,W.DWORD]
            gdi.CreateDIBSection.restype=ctypes.c_void_p
            gdi.SelectObject.argtypes=[ctypes.c_void_p,ctypes.c_void_p];gdi.SelectObject.restype=ctypes.c_void_p
            gdi.DeleteObject.argtypes=[ctypes.c_void_p];gdi.DeleteDC.argtypes=[ctypes.c_void_p]
            gdi.SetStretchBltMode.argtypes=[ctypes.c_void_p,ctypes.c_int]
            gdi.SetBrushOrgEx.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_void_p]
            gdi.StretchBlt.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,W.DWORD]
            screen_dc=self.user.GetDC(None);mem_dc=gdi.CreateCompatibleDC(screen_dc)
            header=_BitmapInfoHeader();header.biSize=ctypes.sizeof(_BitmapInfoHeader)
            header.biWidth,header.biHeight=self.size,-self.size
            header.biPlanes,header.biBitCount=1,32
            bits=ctypes.c_void_p()
            bitmap=gdi.CreateDIBSection(screen_dc,ctypes.byref(header),0,ctypes.byref(bits),None,0)
            if not screen_dc or not mem_dc or not bitmap or not bits.value:raise RuntimeError('Could not allocate GDI capture surface')
            previous=gdi.SelectObject(mem_dc,bitmap)
            import cv2
            import numpy as np
            bgra=np.ctypeslib.as_array((ctypes.c_uint8*(self.size*self.size*4)).from_address(bits.value)).reshape(self.size,self.size,4)
            while not self._stop.is_set():
                before=time.perf_counter()
                if self.user.IsIconic(self.hwnd) or not self.user.IsWindowEnabled(self.hwnd):self._stop.wait(.1);continue
                x,y,width,height,_,_=_client_geometry(self.user,self.hwnd)
                gdi.SetStretchBltMode(mem_dc,HALFTONE);gdi.SetBrushOrgEx(mem_dc,0,0,None)
                if not gdi.StretchBlt(mem_dc,0,0,self.size,self.size,screen_dc,x,y,width,height,SRCCOPY):
                    raise RuntimeError('Screen capture failed')
                gdi.GdiFlush()
                self.slot.publish((cv2.cvtColor(bgra,cv2.COLOR_BGRA2BGR),width,height),(time.perf_counter()-before)*1000)
                self._stop.wait(max(0,1/60-(time.perf_counter()-before)))
        except Exception as error:
            self.slot.fail(error)
        finally:
            if previous and mem_dc:gdi.SelectObject(mem_dc,previous)
            if bitmap:gdi.DeleteObject(bitmap)
            if mem_dc:gdi.DeleteDC(mem_dc)
            if screen_dc:self.user.ReleaseDC(None,screen_dc)
    def read(self,last_seq=0,timeout=5.0):
        return self.slot.read(last_seq,timeout)
    def close(self):
        self._stop.set()
        with contextlib.suppress(Exception):self._thread.join(timeout=2)

def create_capture(title):
    capture=None
    try:
        capture=WgcCapture(title)
        capture.read(0,timeout=4.0)
        print('capture backend: windows-graphics-capture (window-targeted)',file=sys.stderr)
        return capture
    except CaptureTimeout:
        print('capture backend: windows-graphics-capture (waiting for restored window)',file=sys.stderr)
        return capture
    except Exception as error:
        if capture:capture.close()
        print(f'WGC unavailable ({error}); falling back to GDI',file=sys.stderr)
        return GdiCapture(title)

class CudaGraphDetector:
    """Fixed-shape YOLO forward replay; standard Ultralytics NMS stays unchanged."""
    name='CUDA graph / FP16'
    def __init__(self,yolo,device):
        import numpy as np
        import torch
        from ultralytics.utils.nms import non_max_suppression
        self.torch=torch;self.nms=non_max_suppression;self.names=yolo.names
        self.device=torch.device('cuda:'+str(device) if str(device).isdigit() else str(device))
        self.net=yolo.model.to(self.device).eval().half().fuse(verbose=False)
        self.host=torch.empty((1,3,MODEL_SIZE,MODEL_SIZE),dtype=torch.uint8,pin_memory=True)
        self.host_array=self.host.numpy()[0]
        self.device_bytes=torch.zeros_like(self.host,device=self.device)
        self.model_input=torch.zeros(self.host.shape,device=self.device,dtype=torch.float16)
        self.graph=torch.cuda.CUDAGraph()
        with torch.cuda.device(self.device),torch.inference_mode():
            stream=torch.cuda.Stream(device=self.device);stream.wait_stream(torch.cuda.current_stream())
            with torch.cuda.stream(stream):
                for _ in range(4):self.net(self.model_input)
            torch.cuda.current_stream().wait_stream(stream)
            with torch.cuda.graph(self.graph):
                self.model_input.copy_(self.device_bytes)
                self.model_input.mul_(1/255)
                self.prediction=self.net(self.model_input)[0]
            torch.cuda.synchronize(self.device)
            self.predict(np.zeros((MODEL_SIZE,MODEL_SIZE,3),dtype=np.uint8),.35)
    def predict(self,bgr,confidence):
        import numpy as np
        torch=self.torch
        with torch.cuda.device(self.device),torch.inference_mode():
            np.copyto(self.host_array,bgr[:,:,::-1].transpose(2,0,1))
            self.device_bytes.copy_(self.host,non_blocking=True)
            self.graph.replay()
            # NMS can edit its input, so keep the graph-owned tensor intact.
            return self.nms(self.prediction.clone(),conf_thres=confidence,iou_thres=.7,nc=len(self.names))[0].cpu().numpy()

def main():
    sys.stdout.reconfigure(encoding='utf-8');sys.stderr.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser();parser.add_argument('--model',type=Path,required=True)
    group=parser.add_mutually_exclusive_group(required=True);group.add_argument('--source',type=Path);group.add_argument('--window')
    parser.add_argument('--confidence',type=float,default=.35);parser.add_argument('--device',default='cpu')
    parser.add_argument('--max-frames',type=int,default=0)
    parser.add_argument('--no-cuda-graph',action='store_true')
    args=parser.parse_args()
    if not args.model.is_file():raise FileNotFoundError(args.model)
    with contextlib.redirect_stdout(sys.stderr):
        import cv2
        import torch
        from ultralytics import YOLO
        torch.set_num_threads(1)
        cv2.setNumThreads(1)
        model=YOLO(str(args.model))
    # fp16 roughly halves the GPU's share of the frame and is a no-op on CPU.
    half=args.device!='cpu'
    detector=None
    if half and not args.no_cuda_graph:
        try:
            with contextlib.redirect_stdout(sys.stderr):detector=CudaGraphDetector(model,args.device)
            print('inference backend: '+detector.name,file=sys.stderr)
        except Exception as error:
            print(f'CUDA graph unavailable ({error}); using standard YOLO',file=sys.stderr)
    image_mode=args.source and args.source.suffix.lower() in {'.png','.jpg','.jpeg','.webp','.bmp'}
    capture=create_capture(args.window) if args.window else None
    video=None
    if args.source and not image_mode:
        video=cv2.VideoCapture(str(args.source))
        if not video.isOpened():raise RuntimeError('Cannot open the selected video')
    count=0;started=time.perf_counter();color=(196,225,115);capture_seq=0;last_preview=0.0;recent=deque(maxlen=120);paused=False
    performance=deque(maxlen=180);last_diagnostic=0
    diagnostic=Path(tempfile.gettempdir())/f'zen-workbench-vision-{os.getpid()}.json'
    try:
        while not args.max_frames or count<args.max_frames:
            cycle_start=time.perf_counter()
            if capture:
                # Already at model resolution; no full-size copy or resize needed.
                try:model_input,source_width,source_height,capture_seq=capture.read(capture_seq,timeout=1.0)
                except CaptureTimeout:
                    if not paused:emit({'type':'paused','message':'Capture paused — restore or reconnect Remote Play to resume. No fresh detections are being sent.'})
                    paused=True;continue
                if paused:recent.clear();paused=False
            else:
                if image_mode:
                    if count:break
                    frame=cv2.imread(str(args.source))
                    if frame is None:raise RuntimeError('Cannot decode the selected image')
                else:
                    ok,frame=video.read()
                    if not ok:break
                source_height,source_width=frame.shape[:2]
                # The supplied Roboflow dataset was stretched to 640x640; match it.
                model_input=cv2.resize(frame,(MODEL_SIZE,MODEL_SIZE),interpolation=cv2.INTER_LINEAR)
            before=time.perf_counter()
            capture_wait_ms=(time.perf_counter()-cycle_start)*1000
            with contextlib.redirect_stdout(sys.stderr):
                if detector:
                    rows=detector.predict(model_input,args.confidence)
                else:
                    try:
                        result=model.predict(model_input,conf=args.confidence,device=args.device,imgsz=MODEL_SIZE,rect=False,half=half,verbose=False)[0]
                    except Exception:
                        if not half:raise
                        half=False
                        result=model.predict(model_input,conf=args.confidence,device=args.device,imgsz=MODEL_SIZE,rect=False,half=half,verbose=False)[0]
                    rows=result.boxes.data.cpu().numpy() if len(result.boxes) else ()
            elapsed=(time.perf_counter()-before)*1000
            # Boxes come back in model space; report them in source-frame pixels so
            # the controller's field of view keeps the real aspect ratio.
            scale_x,scale_y=source_width/MODEL_SIZE,source_height/MODEL_SIZE
            objects=[]
            # One device->host transfer for every box; .item() per field would force
            # a separate GPU sync each time.
            for row in rows:
                mx1,my1,mx2,my2=(float(row[0]),float(row[1]),float(row[2]),float(row[3]))
                score=float(row[4]);cls=int(row[5])
                objects.append({'class':cls,'label':model.names[cls],'confidence':score,
                    'box':[mx1*scale_x,my1*scale_y,mx2*scale_x,my2*scale_y]})
            count+=1
            moment=time.perf_counter();recent.append(moment)
            while len(recent)>2 and moment-recent[0]>2:recent.popleft()
            # Stamp the frame when its detections are ready to publish, not when the
            # source frame was grabbed. Inference latency would otherwise be counted
            # against the controller's freshness window (targetMaxAgeMs), so on a slow
            # device every frame would arrive already stale and L2 right-stick
            # correction would never engage.
            payload={'type':'frame','frame':count,'capturedAt':round(time.time()*1000),
                'resolution':[source_width,source_height],'inferenceMs':elapsed,
                'fps':(len(recent)-1)/max(.001,recent[-1]-recent[0]) if len(recent)>1 else 0,
                'cumulativeFps':count/max(.001,time.perf_counter()-started),'objects':objects,
                'captureWaitMs':capture_wait_ms,'inferenceBackend':detector.name if detector else ('CUDA FP16' if half else 'CPU'),
                'captureFps':capture.slot.stats()['captureFps'] if capture else None,
                'captureBackend':'WGC' if isinstance(capture,WgcCapture) else ('GDI' if capture else 'File'),
                'previewFps':1/PREVIEW_INTERVAL}
            if moment-last_preview>=PREVIEW_INTERVAL or count==1:
                last_preview=moment
                annotated=model_input.copy()
                for row in rows:
                    mx1,my1,mx2,my2=(round(float(row[0])),round(float(row[1])),round(float(row[2])),round(float(row[3])))
                    cv2.rectangle(annotated,(mx1,my1),(mx2,my2),color,2)
                    cv2.putText(annotated,f'{model.names[int(row[5])]} {float(row[4]):.2f}',(mx1,max(18,my1-7)),
                        cv2.FONT_HERSHEY_SIMPLEX,.5,color,1,cv2.LINE_AA)
                # Undo the square stretch so the preview keeps the source aspect ratio.
                preview_width=min(PREVIEW_MAX_WIDTH,source_width)
                preview_height=max(1,round(preview_width*source_height/source_width))
                preview=cv2.resize(annotated,(preview_width,preview_height),interpolation=cv2.INTER_LINEAR)
                encoded_ok,encoded=cv2.imencode('.jpg',preview,[cv2.IMWRITE_JPEG_QUALITY,PREVIEW_QUALITY])
                if not encoded_ok:raise RuntimeError('Preview encoding failed')
                payload['jpeg']=base64.b64encode(encoded.tobytes()).decode('ascii')
            preview_ms=(time.perf_counter()-moment)*1000
            emit_start=time.perf_counter()
            emit(payload)
            emit_ms=(time.perf_counter()-emit_start)*1000
            performance.append({'wait':capture_wait_ms,'inference':elapsed,'preview':preview_ms,'emit':emit_ms,'loop':(time.perf_counter()-cycle_start)*1000})
            if time.perf_counter()-last_diagnostic>=2:
                last_diagnostic=time.perf_counter();stats=capture.slot.stats() if capture else {}
                stats.update({'pid':os.getpid(),'at':round(time.time()*1000),'detectionFps':payload['fps'],
                  'inferenceBackend':payload['inferenceBackend'],'captureBackend':payload['captureBackend'],
                  'sourceResolution':payload['resolution'],'samples':len(performance),
                  'meanMs':{key:sum(row[key] for row in performance)/len(performance) for key in performance[0]}})
                with contextlib.suppress(OSError):
                    temporary=diagnostic.with_suffix('.tmp');temporary.write_text(json.dumps(stats));os.replace(temporary,diagnostic)
    finally:
        if video:video.release()
        if capture:capture.close()

if __name__=='__main__':
    try:main()
    except Exception as error:
        emit({'type':'error','message':str(error)})
        raise SystemExit(1)
